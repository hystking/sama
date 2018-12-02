var doc = app.activeDocument;

var rasterize = function(layer){
    var layer_name = layer.name;
    var layer_visible = layer.visible;
    var container = layer.parent.layerSets;
    var merger = doc.layerSets.add();
    merger.move(layer, ElementPlacement.PLACEBEFORE);
    layer.duplicate(merger, ElementPlacement.INSIDE);
    merger.artLayers.add();
    var new_layer = merger.merge();
    new_layer.name = layer_name;
    new_layer.visible = layer_visible;
    layer.remove();
};


function getAllArtLayers(obj, layersArray) {
  for( var i = obj.artLayers.length-1; i >= 0; i--) {
    var layer = obj.artLayers[i];
    if(layer.allLocked){
      var visible = layer.visible;
      layer.allLocked = false;
      layer.visible = visible;
    }
    layersArray.push(layer);
  }
  for( var i = obj.layerSets.length-1; i >= 0; i--) {
    var layerSet = obj.layerSets[i];
    if(layerSet.allLocked){
      var visible = layerSet.visible;
      layerSet.allLocked = false;
      layerSet.visible = visible;
    }
    getAllArtLayers(layerSet, layersArray);
  }
}

function main(){
  var allArtLayers = new Array;
  var allVisibleInfo = new Array;
  getAllArtLayers(doc, allArtLayers, allVisibleInfo);
  for (var i=0; i<allArtLayers.length; i++) {
    rasterize(allArtLayers[i]);
  }
}

main();