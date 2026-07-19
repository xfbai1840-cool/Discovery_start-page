const $ = selector => document.querySelector(selector);
const state = { file:null, imageData:null, width:0, height:0, auto:[], manual:[], removed:new Set(), analysis:null, nextManual:1 };
const canvas = $('#colonyCanvas');

function toast(message){const box=$('#colonyToast');box.textContent=message;box.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.classList.remove('show'),2700)}
function formatBytes(bytes){return bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function plateGeometry(){return {cx:state.width*Number($('#plateX').value)/100,cy:state.height*Number($('#plateY').value)/100,r:Math.min(state.width,state.height)*Number($('#plateScale').value)/200}}
function detections(){return [...state.auto.filter(item=>!state.removed.has(item.id)),...state.manual]}

$('#colonyChoose').addEventListener('click',()=>$('#colonyFile').click());
$('#colonyFile').addEventListener('change',event=>event.target.files[0]&&loadImage(event.target.files[0]));
const drop=$('#colonyUpload');
['dragenter','dragover'].forEach(name=>drop.addEventListener(name,event=>{event.preventDefault();drop.classList.add('dragging')}));
['dragleave','drop'].forEach(name=>drop.addEventListener(name,event=>{event.preventDefault();drop.classList.remove('dragging')}));
drop.addEventListener('drop',event=>event.dataTransfer.files[0]&&loadImage(event.dataTransfer.files[0]));

async function loadImage(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))return toast('请选择 PNG、JPEG 或 WebP 图像');
  try{
    const bitmap=await createImageBitmap(file),maxSide=1400,scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    state.width=Math.max(1,Math.round(bitmap.width*scale));state.height=Math.max(1,Math.round(bitmap.height*scale));
    const source=document.createElement('canvas');source.width=state.width;source.height=state.height;const context=source.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0,state.width,state.height);const originalWidth=bitmap.width,originalHeight=bitmap.height;bitmap.close();
    state.file=file;state.imageData=context.getImageData(0,0,state.width,state.height);state.auto=[];state.manual=[];state.removed=new Set();state.analysis=null;state.nextManual=1;
    canvas.width=state.width;canvas.height=state.height;
    $('#colonyFileName').textContent=file.name;$('#colonyFileMeta').textContent=`${originalWidth} × ${originalHeight} px · ${formatBytes(file.size)}`;$('#analysisSize').textContent=`${state.width} × ${state.height}`;
    drawThumb(source);$('#colonyUpload').hidden=true;$('#colonyWorkspace').hidden=false;renderAll();toast(scale<1?'图像已缩放用于快速分析，请调整培养皿边界':'图像已载入，请调整培养皿边界后运行计数');
  }catch(error){console.error(error);toast('无法读取图像，请转换为 PNG 或 JPEG 后重试')}
}
function drawThumb(source){const thumb=$('#colonyThumb');thumb.width=92;thumb.height=78;const scale=Math.max(thumb.width/source.width,thumb.height/source.height),w=source.width*scale,h=source.height*scale;thumb.getContext('2d').drawImage(source,(thumb.width-w)/2,(thumb.height-h)/2,w,h)}

['plateScale','plateX','plateY'].forEach(id=>$('#'+id).addEventListener('input',event=>{const output={plateScale:'plateScaleOut',plateX:'plateXOut',plateY:'plateYOut'}[id];$('#'+output).textContent=`${event.target.value}%`;markDirty();drawCanvas()}));
$('#thresholdOffset').addEventListener('input',event=>{$('#thresholdOffsetOut').textContent=event.target.value;markDirty()});
['objectPolarity','minDiameter','maxDiameter','roundness'].forEach(id=>$('#'+id).addEventListener('change',markDirty));
function markDirty(){if(state.analysis){$('#countStatus').textContent='参数已更改 · 请重新计数'}}

$('#countButton').addEventListener('click',()=>{if(!state.imageData)return;$('#countBusy').hidden=false;$('#countButton').disabled=true;setTimeout(()=>{try{runCounting();toast(`自动识别完成：${state.auto.length} 个对象`)}catch(error){console.error(error);toast('计数失败，请调整参数或使用较小图像')}finally{$('#countBusy').hidden=true;$('#countButton').disabled=false}},50)});

function runCounting(){
  const {cx,cy,r}=plateGeometry(),count=state.width*state.height,data=state.imageData.data,values=new Uint8Array(count),histogram=new Uint32Array(256);let platePixels=0;
  for(let y=0,index=0;y<state.height;y++)for(let x=0;x<state.width;x++,index++){const p=index*4,value=Math.round(.2126*data[p]+.7152*data[p+1]+.0722*data[p+2]);values[index]=value;if((x-cx)**2+(y-cy)**2<=r*r){histogram[value]++;platePixels++}}
  const otsu=otsuThreshold(histogram,platePixels),threshold=clamp(otsu+Number($('#thresholdOffset').value),1,254),dark=$('#objectPolarity').value==='dark',mask=new Uint8Array(count);
  for(let y=0,index=0;y<state.height;y++)for(let x=0;x<state.width;x++,index++)if((x-cx)**2+(y-cy)**2<=r*r)mask[index]=dark?values[index]<threshold:values[index]>threshold;
  const minD=Math.max(1,Number($('#minDiameter').value)),maxD=Math.max(minD,Number($('#maxDiameter').value)),roundness=Number($('#roundness').value);
  state.auto=detectComponents(mask,state.width,state.height,minD,maxD,roundness);state.auto.forEach((item,index)=>item.id=`auto_${index+1}`);state.manual=[];state.removed=new Set();state.nextManual=1;state.analysis={otsu,threshold,automatic:state.auto.length};renderAll();
}

function otsuThreshold(histogram,total){let sum=0;for(let i=0;i<256;i++)sum+=i*histogram[i];let bgWeight=0,bgSum=0,best=-1,threshold=0;for(let i=0;i<256;i++){bgWeight+=histogram[i];if(!bgWeight)continue;const fgWeight=total-bgWeight;if(!fgWeight)break;bgSum+=i*histogram[i];const bgMean=bgSum/bgWeight,fgMean=(sum-bgSum)/fgWeight,variance=bgWeight*fgWeight*(bgMean-fgMean)**2;if(variance>best){best=variance;threshold=i}}return threshold}
function detectComponents(mask,width,height,minDiameter,maxDiameter,minCircularity){
  const total=width*height,visited=new Uint8Array(total),queue=new Int32Array(total),found=[];
  for(let start=0;start<total;start++){
    if(!mask[start]||visited[start])continue;let head=0,tail=1,sumX=0,sumY=0,perimeter=0;queue[0]=start;visited[start]=1;
    while(head<tail){const index=queue[head++],x=index%width,y=(index/width)|0;sumX+=x;sumY+=y;const neighbors=[[x-1,y,index-1],[x+1,y,index+1],[x,y-1,index-width],[x,y+1,index+width]];for(const [nx,ny,ni] of neighbors){if(nx<0||nx>=width||ny<0||ny>=height||!mask[ni]){perimeter++;continue}if(!visited[ni]){visited[ni]=1;queue[tail++]=ni}}}
    const diameter=2*Math.sqrt(tail/Math.PI),circularity=perimeter?4*Math.PI*tail/(perimeter*perimeter):0;
    if(diameter>=minDiameter&&diameter<=maxDiameter&&circularity>=minCircularity)found.push({x:sumX/tail,y:sumY/tail,area:tail,diameter,circularity,manual:false});
  }
  return found;
}

function pointFromEvent(event){const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*state.width/rect.width,y:(event.clientY-rect.top)*state.height/rect.height}}
canvas.addEventListener('click',event=>{
  if(!state.analysis)return toast('请先运行自动计数');const point=pointFromEvent(event),plate=plateGeometry();if((point.x-plate.cx)**2+(point.y-plate.cy)**2>plate.r**2)return toast('点击位置在培养皿分析范围外');
  const all=detections();let nearest=null,distance=Infinity;all.forEach(item=>{const d=Math.hypot(item.x-point.x,item.y-point.y);if(d<distance){distance=d;nearest=item}});
  if(nearest&&distance<Math.max(9,nearest.diameter*.75)){if(nearest.manual)state.manual=state.manual.filter(item=>item.id!==nearest.id);else state.removed.add(nearest.id);toast('已删除该识别点')}else{const diameters=all.map(item=>item.diameter).sort((a,b)=>a-b),diameter=diameters.length?diameters[Math.floor(diameters.length/2)]:Math.max(6,Number($('#minDiameter').value)*1.5);state.manual.push({id:`manual_${state.nextManual++}`,x:point.x,y:point.y,diameter,area:Math.PI*(diameter/2)**2,circularity:1,manual:true});toast('已手动添加一个计数点')}renderAll();
});

function drawCanvas(){
  if(!state.imageData)return;const context=canvas.getContext('2d');context.putImageData(state.imageData,0,0);const plate=plateGeometry(),line=Math.max(1.5,state.width/800);context.lineWidth=line*1.5;context.setLineDash([line*5,line*3]);context.strokeStyle='rgba(255,208,120,.9)';context.beginPath();context.arc(plate.cx,plate.cy,plate.r,0,Math.PI*2);context.stroke();context.setLineDash([]);
  detections().forEach(item=>{context.lineWidth=line;context.strokeStyle=item.manual?'#ffd078':'#a8b2ff';context.fillStyle=item.manual?'rgba(255,208,120,.10)':'rgba(168,178,255,.10)';context.beginPath();context.arc(item.x,item.y,Math.max(3,item.diameter/2),0,Math.PI*2);context.fill();context.stroke()});
}
function renderAll(){drawCanvas();const all=detections(),count=all.length,avg=count?all.reduce((sum,item)=>sum+item.diameter,0)/count:0,manualRemoved=state.removed.size;$('#totalObjects').textContent=count.toLocaleString();$('#averageDiameter').textContent=count?`${avg.toFixed(1)} px`:'—';$('#autoCount').textContent=state.analysis?.automatic||0;$('#manualAdded').textContent=state.manual.length;$('#manualRemoved').textContent=manualRemoved;$('#otsuValue').textContent=state.analysis?.otsu??'—';$('#appliedThreshold').textContent=state.analysis?.threshold??'—';$('#countStatus').textContent=state.analysis?`${count} 个 · 点击图像可校正`:'等待分析';$('#colonyViewerInfo').textContent=`分析范围：圆心 ${$('#plateX').value}% / ${$('#plateY').value}% · 直径 ${$('#plateScale').value}%`;updateCalculations()}
function updateCalculations(){const count=detections().length,diameterMm=Number($('#plateDiameterMm').value),volume=Number($('#platedVolume').value),exponent=Number($('#dilutionExponent').value),areaCm2=Math.PI*(diameterMm/20)**2,density=areaCm2>0?count/areaCm2:0,concentration=volume>0?count/(volume*10**exponent):0;$('#plateDensity').textContent=count&&Number.isFinite(density)?density.toFixed(2):'—';$('#cultureConcentration').textContent=count&&Number.isFinite(concentration)?concentration.toExponential(2):'—';$('#dilutionExample').textContent=`当前：10${superscript(exponent)}`}
function superscript(value){return String(value).replace(/-/g,'⁻').replace(/[0-9]/g,digit=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)])}
['plateDiameterMm','platedVolume'].forEach(id=>$('#'+id).addEventListener('input',updateCalculations));$('#dilutionExponent').addEventListener('input',updateCalculations);
$('#restoreCount').addEventListener('click',()=>{state.manual=[];state.removed=new Set();renderAll()});$('#clearCount').addEventListener('click',()=>{state.removed=new Set(state.auto.map(item=>item.id));state.manual=[];renderAll()});
$('#colonyReset').addEventListener('click',()=>{$('#colonyFile').value='';state.imageData=null;state.auto=[];state.manual=[];state.analysis=null;$('#colonyWorkspace').hidden=true;$('#colonyUpload').hidden=false});

$('#colonyCsv').addEventListener('click',()=>{if(!state.analysis)return toast('请先运行自动计数');const all=detections(),exp=Number($('#dilutionExponent').value),volume=Number($('#platedVolume').value),diameter=Number($('#plateDiameterMm').value),concentration=all.length/(volume*10**exp);const meta=['metric,value',`file,${csvCell(state.file.name)}`,`total_count,${all.length}`,`automatic_count,${state.analysis.automatic}`,`manual_added,${state.manual.length}`,`manual_removed,${state.removed.size}`,`otsu_threshold,${state.analysis.otsu}`,`applied_threshold,${state.analysis.threshold}`,`plate_diameter_mm,${diameter}`,`dilution_exponent,${exp}`,`plated_volume_ml,${volume}`,`estimated_cfu_pfu_per_ml,${concentration}`].join('\n');const rows='\n\nid,type,x_px,y_px,diameter_px,area_px,circularity\n'+all.map((item,index)=>[index+1,item.manual?'manual':'automatic',item.x.toFixed(3),item.y.toFixed(3),item.diameter.toFixed(3),item.area.toFixed(3),item.circularity.toFixed(4)].join(',')).join('\n');downloadText('\ufeff'+meta+rows,resultName('_colony_plaque_count.csv'),'text/csv;charset=utf-8')});
$('#colonyPng').addEventListener('click',()=>{if(!state.analysis)return toast('请先运行自动计数');drawCanvas();canvas.toBlob(blob=>downloadBlob(blob,resultName('_counted.png')),'image/png')});
$('#colonyMethods').addEventListener('click',()=>{if(!state.analysis)return toast('请先运行自动计数');const text=`Colony/plaque counting parameters\n\nImage: ${state.file.name}\nObject polarity: ${$('#objectPolarity').value}\nPlate analysis diameter: ${$('#plateScale').value}% of image short side\nPlate center: X ${$('#plateX').value}%, Y ${$('#plateY').value}%\nOtsu threshold: ${state.analysis.otsu}\nApplied threshold: ${state.analysis.threshold}\nAccepted diameter: ${$('#minDiameter').value}–${$('#maxDiameter').value} analysis pixels\nMinimum circularity: ${$('#roundness').value}\nFinal count after manual correction: ${detections().length}\n\nMethod: The plate region was manually positioned and segmented using Otsu's global threshold with a user-defined offset in the browser-based Discovery Lab colony/plaque counter. Four-connected components were filtered by equivalent circular diameter and circularity. All detections were visually reviewed, and false-positive or missed objects were manually corrected. Titer was calculated as count divided by plated volume and sample dilution.\n`;downloadText(text,resultName('_counting_methods.txt'),'text/plain;charset=utf-8')});
function csvCell(value){return `"${String(value).replaceAll('"','""')}"`}
function resultName(suffix){return (state.file?.name||'plate').replace(/\.[^.]+$/,'')+suffix}
function downloadText(content,name,type){downloadBlob(new Blob([content],{type}),name)}function downloadBlob(blob,name){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
