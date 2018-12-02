#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const Readable = require("stream").Readable;

const _ = require("lodash");
const mkdirp = require("mkdirp");
const md5 = require("md5");
const PSD = require('psd');
const argv = require("yargs").argv;
const Jimp = require("jimp");

const SCALE = .5;
const PUBLIC_PATH = "public/";
const CSS_PATH = "src/css/";
const PUG_PATH = "src/pug/";

let seqenceIdEnumarator = 0;

const startAt = Date.now();
const mode = argv.mode ? argv.mode.toLowerCase() : "absolute";
const bem = argv.bem ? true : false;
const targetLayerName = argv.layer ? argv.layer : null;

main();

function main() {
  load(argv._[0], argv._[1])
    .then(root => exportFiles(root, argv.o))
    .then(() => console.log("Finished in " + (Date.now() - startAt) + "ms"));
}

function getClassName(node, parents) {
  if(bem) {
    const parentsAndMe = [...parents, node];
    return parentsAndMe.filter(p => !p.clearfix).map(p => p.safeName).join("__");
  }
  const parentsAndMe = [...parents, node].splice(1);
  return parentsAndMe.filter(p => !p.clearfix).map(p => p.safeName).join("__");
}

function overlapAreaY(node1, node2) {
  // node1 と node2 が重なるYを返す
  // +-------+
  // | node1 |
  // +-------+
  // +-------+
  // | node2 |
  // +-------+
  if(node2.top > node1.top + node1.height) {
    return 0; // 全く重ならないケース
  }
  if(node2.top + node2.height > node1.top + node1.height) {
    return node1.top + node1.height - node2.top; // オーバラップするケース
  }
  return node2.height; // node2 が完全に含まれるケース
}

function overlapAreaX(node1, node2) {
  // node1 と node2 が重なるXを返す
  // +-------+ +-------+
  // | node1 | | node2 |
  // +-------+ +-------+
  if(node2.left > node1.left + node1.width) {
    return 0; // 全く重ならないケース
  }
  if(node2.left + node2.width > node1.left + node1.width) {
    return node1.left + node1.width - node2.left; // オーバラップするケース
  }
  return node2.width; // node2 が完全に含まれるケース
}

function getSequenceId() {
  return seqenceIdEnumarator++;
}

function mkdirpForDirectoryPromise(fullPath, callback) {
  // fullPathのディレクトリまでmkdirpする
  const dirname = path.dirname(fullPath);
  return new Promise((resolve, reject) => {
    mkdirp(dirname, err => {
      if(err) {
        reject(err);
      }
      resolve();
    });
  });
}

function createTextStream(text) {
  const stream = new Readable();
  stream.push(text);
  stream.push(null);
  return stream;
}

function saveStreamPromise(fullPath, stream) {
  return new Promise(resolve => {
    stream.pipe(fs.createWriteStream(fullPath)).on("finish", resolve);
  });
}

function mkdirpAndSaveStreamPromise(fullPath, stream) {
  // fullPathのディレクトリまでmkdirpしたあと、fullPathにファイルを保存する
  return mkdirpForDirectoryPromise(fullPath).then(() => saveStreamPromise(fullPath, stream));
}

function addSafeName(node, parents) {
  // CSSやClassにつかっていい名前を safeName を追加する
  const bemmedName = bem ? node.name.replace(/[/]/g, "__") : node.name;
  const escapedName = bemmedName.toLowerCase().replace(/[ 　&.:/]/g, "-");
  node.safeName = /^[a-zA-Z0-9_-]+$/.test(escapedName) ? escapedName : `dw${md5(node.name)}`; // 英字で構成されてなかったらMD5
}

function addPath(node, parents) {
  // パスを node.path に設定する
  if(parents.length <= 0) {
    node.path = "";
    return;
  }
  const rootName = parents[0].name;
  node.path = `${rootName}/${parents.splice(1).map(p => p.safeName).join("/")}/`;
}

function addImagePath(node, parents) {
  // 画像のパスを node.imagePath に設定する
  if(node.children.length > 0) {
    return;
  }
  const rootName = parents[0].name;
  const extension = /\.jpe?g$/.test(node.name) ? "jpg" : "png";
  node.imageExtension = extension;
  node.imagePath = `${rootName}/${parents.splice(1).map(p => p.safeName).join("/")}/${node.safeName}.${extension}`;
}

function getLastNotFloatRelativeSibling(node, siblings) {
  // 兄弟のうちでrelativeで最もすぐ上にあるものを返す
  const lastNotFloatRelativeSibling = _(siblings)
    .filter(s => s.layoutType !== "absolute")
    .filter(s => !s.float)
    .filter(s => s.id < node.id)
    .maxBy(s => s.id); // floatではない兄

  const lastResetFloatSibling = _(siblings)
    .filter(s => s.layoutType !== "absolute")
    .filter(s => s.resetFloat)
    .filter(s => s.id <= node.id)
    .maxBy(s => s.id); // resetFloatの兄

  if(!lastNotFloatRelativeSibling && !lastResetFloatSibling) {
    // 両方共ないならnull
    return null;
  }

  if(!lastResetFloatSibling) {
    // resetFloatがないならfloatではない兄を返す
    return lastNotFloatRelativeSibling;
  }

  if(!lastNotFloatRelativeSibling) {
    // floatじゃない兄がないならresetFloat以前の兄の中でbottomが一番低いやつ
    return _(siblings)
      .filter(s => s.id < lastResetFloatSibling.id) // resetFloatよりは前
      .maxBy(s => s.top + s.height);
  }

  if(lastResetFloatSibling.id < lastNotFloatRelativeSibling.id) {
    // resetFloatの兄がfloatではない兄より前なら、floatではない兄を返す
    return lastNotFloatRelativeSibling;
  }

  // floatでない兄とresetFloatの兄で挟み込むケース
  return _(siblings)
    .filter(s => lastNotFloatRelativeSibling.id < s.id) // relativeでfloatではない兄よりは跡
    .filter(s => s.id < lastResetFloatSibling.id) // resetFloatよりは前
    .maxBy(s => s.top + s.height);
}

function getLastRelativeSibling(node, siblings) {
  // 兄弟のうちでrelativeで最もすぐ上にあるものを返す
  return _(siblings)
    .filter(s => s.layoutType !== "absolute")
    .filter(s => s.id < node.id)
    .maxBy(s => s.id); // すぐ上の兄弟
}

function getParent(parents) {
  return _(parents).last();
}

function addLayoutType(node, parents, siblings) {
  // レイアウトタイプを設定する

  node.float = false;

  const parent = getParent(parents);
  const lastRelativeSibling = getLastRelativeSibling(node, siblings);

  if(!parent) {
    // ルートは積み上げ
    node.layoutType = "relative-vertical";
    return;
  }

  const parentArea = parent.width * parent.height;
  const overlapArea = overlapAreaY(parent, node) * overlapAreaX(parent, node);

  if(overlapArea / parentArea > 0.8) {
    // 親に対して領域が支配的なものはaboslute（背景とか）
    node.layoutType = "absolute";
    return
  }

  if(!lastRelativeSibling) {
    // relativeな兄が居ない場合は積み上げ
    node.layoutType = "relative-vertical";
    return
  }

  if(overlapAreaY(lastRelativeSibling, node) / node.height < 0.3) {
    // 縦方向にあまり重なっていない場合も積み上げ
    node.layoutType = "relative-vertical";
    return
  }

  if(overlapAreaX(lastRelativeSibling, node) / node.width < 0.3) {
    // 横方向にあまり重なっていない場合は横並び
    node.layoutType = "relative-horizontal";
    // 兄はfloat
    lastRelativeSibling.float = true;

    if(lastRelativeSibling.layoutType === "relative-vertical") {
      const nextSibling = getLastRelativeSibling(lastRelativeSibling, siblings);
      if(nextSibling && nextSibling.float) {
        // 同じレイヤーの中で段落ちするケース
        lastRelativeSibling.resetFloat = true;
      }
    }

    // 自身もfloat
    node.float = true;
    return
  }

  // それ以外は絶対配置
  node.layoutType = "absolute";
}

function saveJpeg(node, fullPath) {
  return new Promise(resolve => {
    const stream = node.originalNode.toPng().pack();
    const bufs = [];
    stream.on("data", buf => bufs.push(buf));
    stream.on("end", () => {
      Jimp.read(Buffer.concat(bufs))
        .then(image => image.write(fullPath))
        .then(resolve);
    });
  });
}

function saveImage(exportRoot) {
  return function(node, parents) {
    if(!node.imagePath) {
      return Promise.resolve();
    }
    const fullPath = `${exportRoot}/${node.imagePath}`;
    return mkdirpForDirectoryPromise(fullPath).then(function() {
      if(node.imageExtension === "png") {
        return saveStreamPromise(fullPath, node.originalNode.toPng().pack());
      } else if (node.imageExtension === "jpg") {
        return saveJpeg(node, fullPath);
      }
    });
  }
}

function getAppearanceCss(node) {
  // CSSの要素の見た目に関する情報を返す
  return `${
  node.imagePath ? `
  // background-image: resolve("img/${node.imagePath}");
  // background-repeat: no-repeat;
  // background-position: center center;
  // background-size: contain;`
  : ""}${
  // img タグを使うので末端のときは block にする
  node.children.length <= 0 ? `
  display: block;`
  : `
  overflow: hidden;`
  }${
  node.text ? `
  font-family: ${node.text.font.name};
  font-size: ${node.text.font.sizes[0]} * ${SCALE}px;
  color: rgba(${node.text.font.colors[0].join(',')});
  text-align: ${node.text.font.alignment[0]};`
  : ""
  }${
  // opacity が1より小さいならopacityを設定
  node.opacity < 1 ? `
  opacity: ${node.opacity};`
  : ""}`
}

function getRootLayoutCss(node) {
  // 一番親のときのCSS
  return `
${bem ? `.${node.safeName}` : "&"} {
  position: relative;
  width: calc(${node.width} * ${SCALE}px);
  height: calc(${node.height} * ${SCALE}px);
  left: 50%;
  margin-left: calc(${node.width} * ${SCALE} * -0.5px);
  overflow: hidden;
}`
}

function getAbsoluteLayoutCss(node, parents) {
  // ある node の親に対する Absolute 配置の CSS を返す
  const parent = getParent(parents);
  const left = node.left - parent.left;
  const top = node.top - parent.top;

  return `position: absolute;
  left: calc(${left} * ${SCALE}px);
  top: calc(${top} * ${SCALE}px);
  width: calc(${node.width} * ${SCALE}px);
  height: calc(${node.height} * ${SCALE}px);`
}

function getRelativeHorizontalLayoutCss(node, parents, siblings) {
  // 横並びに配置する（闇）

  const parent = getParent(parents);
  const left = node.left - parent.left;
  const top = node.top - parent.top;

  const lastNotFloatRelativeSibling = getLastNotFloatRelativeSibling(node, siblings);
  const lastRelativeSibling = getLastRelativeSibling(node, siblings);

  const accumulativeLeft = lastRelativeSibling ? (lastRelativeSibling.left - parent.left) + lastRelativeSibling.width : 0;
  const relativeLeft = left - accumulativeLeft;

  const accumulativeTop = lastNotFloatRelativeSibling ? (lastNotFloatRelativeSibling.top - parent.top) + lastNotFloatRelativeSibling.height : 0;
  const relativeTop = top - accumulativeTop;

  return `position: relative;
  margin-left: calc(${relativeLeft} * ${SCALE}px);
  margin-top: calc(${relativeTop} * ${SCALE}px);
  width: calc(${node.width} * ${SCALE}px);
  height: calc(${node.height} * ${SCALE}px);`
}


function getRelativeVerticalLayoutCss(node, parents, siblings) {
  // 縦並びに配置する（闇）

  const parent = getParent(parents);
  const left = node.left - parent.left;
  const top = node.top - parent.top;

  const lastRelativeSibling = getLastNotFloatRelativeSibling(node, siblings);
  const accumulativeTop = lastRelativeSibling ? (lastRelativeSibling.top - parent.top) + lastRelativeSibling.height : 0;
  const relativeTop = top - accumulativeTop;

  return `position: relative;
  margin-left: calc(${left} * ${SCALE}px);
  margin-top: calc(${relativeTop} * ${SCALE}px);
  width: calc(${node.width} * ${SCALE}px);
  height: calc(${node.height} * ${SCALE}px);`
}

function nodeAsCssAbsolute(node, parents, siblings) {
  // absoluteのCSSを配置する
  if(parents.length <= 0) {
    // ルートはルートのCSS
    return getRootLayoutCss(node);
  }

  return `
.${getClassName(node, parents)} {
  ${
  getAbsoluteLayoutCss(node, parents, siblings)
  }
  ${
  getAppearanceCss(node)
  }
}`

}

function nodeAsCssRelative(node, parents, siblings) {
  // relativeのCSSを配置する
  if(parents.length <= 0) {
    // ルートはルートのCSS
    return getRootLayoutCss(node);
  }

  return `
.${getClassName(node, parents)} {
  ${
  getRelativeVerticalLayoutCss(node, parents, siblings)
  }
  ${
  getAppearanceCss(node)
  }
}`
}

function nodeAsCssAdaptive(node, parents, siblings) {
  // absoluteかrelativeか判別していい感じに配置する
  if(parents.length <= 0) {
    // ルートはルートのCSS
    return getRootLayoutCss(node);
  }

  return `
.${getClassName(node, parents)} {
  ${
  node.layoutType === "absolute" ? getAbsoluteLayoutCss(node, parents)
: node.layoutType === "relative-vertical" ? getRelativeVerticalLayoutCss(node, parents, siblings)
: getRelativeHorizontalLayoutCss(node, parents, siblings)
  }
  ${
  node.float ? `float: left;`
  : ""
  }
  ${
  getAppearanceCss(node)
  }
}`

}

function nodeAsPug(node, parents, siblings) {
  // ある node の pug を返す
  const indent = _.repeat("  ", parents.length);
  const className = getClassName(node, parents);

  if(parents.length <= 0 && !bem) {
    return `.page-root(data-page="${node.safeName}")`
  }

  if(node.clearfix) {
    return `${indent}.dw-clearfix.${className}__dw-clearfix`
  }

  const text = node.text ? node.text.value.replace(/\r/g, " ") : "";

  return `${
    node.children.length > 0 ? `${indent}.${className} ${text}`
  : node.width > 0 && node.height > 0 ? `${indent}img.${className}(src=imagePath("${node.imagePath}") alt="${text}")`
  : ""
}`
}

function traverseMap(node, func, parents = [], siblings = []) {
  const nextSiblings = node.children;
  return [
    func(node, parents, siblings),
    ...node.children.map(child => traverseMap(child, func, [...parents, node], nextSiblings)),
  ];
}

function getTreeWithClearfix(node) {
  // clearfixつきのtree（DOMにつかう）を得る
  const cloneNode = _.clone(node);
  cloneNode.children = cloneNode.children.map(getTreeWithClearfix);

  const groups = [];
  let stack = [];
  let lastFloat = false;

  for(let i=0; i<cloneNode.children.length; i++) {
    const child = cloneNode.children[i];
    if(child.float && child.resetFloat) {
      groups.push(stack);
      groups.push([]);
      stack = [];
    }
    if(child.float !== lastFloat) {
      groups.push(stack);
      stack = [];
    }
    stack.push(child);
    lastFloat = child.float;
  }

  groups.push(stack);

  let newChildren = [];

  for(let i=0; i<groups.length; i++) {
    const group = groups[i];
    if(group.length <= 0) {
      continue;
    }
    if(i % 2 === 0) {
      // not float
      newChildren = [...newChildren, ...group];
    } else {
      // float
      const clearfixNode = {
        clearfix: true,
        children: group,
      };
      newChildren = [...newChildren, clearfixNode];
    }
  }
  cloneNode.children = newChildren;
  return cloneNode;
}

function parseNodeTree(originalNode) {
  const node = originalNode.export();
  node.originalNode = originalNode;
  node.id = getSequenceId();
  node.children = originalNode.children().reverse().map(parseNodeTree);
  return node;
}

function load(file, rootName) {
  return PSD.open(file).then(function(psd) {
    const root = {
      id: getSequenceId(),
      name: rootName,
      left: 0,
      top: 0,
      width: psd.tree().width,
      height: psd.tree().height,
      children: psd.tree().children().reverse().map(parseNodeTree),
    };
    traverseMap(root, addSafeName);
    traverseMap(root, addPath);
    traverseMap(root, addImagePath);
    if(mode === "adaptive") {
      traverseMap(root, addLayoutType);
    }
    return root;
  }).catch(function(err) {
    console.error(err.stack);
  });
}

function exportFiles(root, exportRoot = ".") {
  if(targetLayerName) {
    const matchedNodes = traverseMap(root, node => node.name === targetLayerName ? node : null);
    const targetNode = _.flattenDeep(matchedNodes).find(node => node != null);
    if(!targetNode) {
      console.log(`layer ${targetLayerName} does not found`);
      return;
    }
    root = targetNode;
  }

  const domTree =
    mode === "adaptive" ? getTreeWithClearfix(root)
  : root;
  const nodeAsCss =
    mode === "absolute" ? nodeAsCssAbsolute
  : mode === "relative" ? nodeAsCssRelative
  : mode === "adaptive" ? nodeAsCssAdaptive
  : nodeAsCssAbsolute;

  const css = _.flattenDeep(traverseMap(root, nodeAsCss)).join("\n");
  const pug = _.flattenDeep(traverseMap(domTree, nodeAsPug)).join("\n");

  const saveImagePromises = _.flattenDeep(traverseMap(root, saveImage(`${exportRoot}/${PUBLIC_PATH}`)));
  const saveCssPromise = mkdirpAndSaveStreamPromise(`${exportRoot}/${CSS_PATH}/${root.path}/${root.name}.css`, createTextStream(css));
  const savePugPromise = mkdirpAndSaveStreamPromise(`${exportRoot}/${PUG_PATH}/${root.path}/${root.name}.pug`, createTextStream(pug));
  if(!bem) {
    console.log(`Add

.page-root[data-page="${root.safeName}"] {
  @import "${root.name}";
}
  
in frontend/css/app.css or frontend/css/app_smart_phone.css`);
  }

  return Promise.all([
    ...saveImagePromises,
    saveCssPromise,
    savePugPromise,
  ])
}
