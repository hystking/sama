// 選択しているカラー調整レイヤーを他の全てのレイヤーに個別に適用させる

function getAllArtLayers(obj, layersArray) {
  for(var i = obj.artLayers.length-1; i >= 0; i--) {
    var layer = obj.artLayers[i];
    if(layer.allLocked){
      var visible = layer.visible;
      layer.allLocked = false;
      layer.visible = visible;
    }
    layersArray.push(layer);
  }
  for(var i = obj.layerSets.length-1; i >= 0; i--) {
    var layerSet = obj.layerSets[i];
    if(layerSet.allLocked){
      var visible = layerSet.visible;
      layerSet.allLocked = false;
      layerSet.visible = visible;
    }
    getAllArtLayers(layerSet, layersArray);
  }
}

function applyColorAdjustmentLayer(baseLayer, targetLayer) {
  if(baseLayer == targetLayer) {
    return;
  }
  var duplicatedBaseLayer = baseLayer.duplicate();
  duplicatedBaseLayer.move(targetLayer, ElementPlacement.PLACEBEFORE);
  duplicatedBaseLayer.name = targetLayer.name;
  duplicatedBaseLayer.merge();
}

function main(){
  var allArtLayers = new Array;
  var currentLayer = activeDocument.activeLayer;
  getAllArtLayers(app.activeDocument, allArtLayers);
  for (var i=0; i<allArtLayers.length; i++) {
    applyColorAdjustmentLayer(currentLayer, allArtLayers[i]);
  }
}

main();
