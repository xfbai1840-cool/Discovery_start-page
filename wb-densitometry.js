const $ = selector => document.querySelector(selector);
const state = { file:null, imageData:null, width:0, height:0, rois:[], drag:null, nextId:1 };
const canvas = $('#wbCanvas');

function toast(message){const box=$('#wbToast');box.textContent=message;box.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.classList.remove('show'),2600)}
function formatBytes(bytes){return bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`}
function normalizedRect(a,b){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)}}
function grayAt(data,offset){return .2126*data[offset]+.7152*data[offset+1]+.0722*data[offset+2]}
function signalFromGray(gray,polarity){return polarity==='dark'?255-gray:gray}

$('#wbChoose').addEventListener('click',()=>$('#wbFile').click());
$('#wbFile').addEventListener('change',event=>event.target.files[0]&&loadImage(event.target.files[0]));
const drop=$('#wbUpload');
['dragenter','dragover'].forEach(name=>drop.addEventListener(name,event=>{event.preventDefault();drop.classList.add('dragging')}));
['dragleave','drop'].forEach(name=>drop.addEventListener(name,event=>{event.preventDefault();drop.classList.remove('dragging')}));
drop.addEventListener('drop',event=>event.dataTransfer.files[0]&&loadImage(event.dataTransfer.files[0]));

async function loadImage(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))return toast('请选择 PNG、JPEG 或 WebP 图像');
  try{
    const bitmap=await createImageBitmap(file);
    if(bitmap.width*bitmap.height>24000000){bitmap.close();return toast('图像超过 2400 万像素，请先缩小后重试')}
    const source=document.createElement('canvas');source.width=bitmap.width;source.height=bitmap.height;
    const context=source.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);bitmap.close();
    state.file=file;state.width=source.width;state.height=source.height;state.imageData=context.getImageData(0,0,state.width,state.height);state.rois=[];state.nextId=1;
    canvas.width=state.width;canvas.height=state.height;
    $('#wbFileName').textContent=file.name;$('#wbFileMeta').textContent=`${state.width} × ${state.height} px · ${formatBytes(file.size)}`;
    drawThumb(source);$('#wbUpload').hidden=true;$('#wbWorkspace').hidden=false;renderAll();toast('图像已载入，请拖动框选第一个条带');
  }catch(error){console.error(error);toast('无法读取图像，请转换为 PNG 或 JPEG 后重试')}
}
function drawThumb(source){const thumb=$('#wbThumb');thumb.width=92;thumb.height=78;const scale=Math.max(thumb.width/source.width,thumb.height/source.height);const w=source.width*scale,h=source.height*scale;thumb.getContext('2d').drawImage(source,(thumb.width-w)/2,(thumb.height-h)/2,w,h)}

function pointFromEvent(event){const rect=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(state.width,(event.clientX-rect.left)*state.width/rect.width)),y:Math.max(0,Math.min(state.height,(event.clientY-rect.top)*state.height/rect.height))}}
canvas.addEventListener('pointerdown',event=>{if(!state.imageData||event.button!==0)return;const point=pointFromEvent(event);state.drag={start:point,end:point};canvas.setPointerCapture(event.pointerId);drawCanvas()});
canvas.addEventListener('pointermove',event=>{if(!state.drag)return;state.drag.end=pointFromEvent(event);drawCanvas()});
canvas.addEventListener('pointerup',event=>{if(!state.drag)return;state.drag.end=pointFromEvent(event);const rect=normalizedRect(state.drag.start,state.drag.end);state.drag=null;if(rect.w<3||rect.h<3){drawCanvas();return toast('ROI 太小，请重新拖动框选')};const roi={id:state.nextId++,label:$('#wbLabel').value.trim()||`Band_${state.nextId-1}`,...roundRect(rect)};roi.metrics=measureRoi(roi);state.rois.push(roi);$('#wbLabel').value='';renderAll();toast(`已添加 ${roi.label}`)});
function roundRect(rect){return {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.max(1,Math.round(rect.w)),h:Math.max(1,Math.round(rect.h))}}

function measureRoi(roi){
  const data=state.imageData.data,polarity=$('#wbPolarity').value;
  const x0=Math.max(0,roi.x),y0=Math.max(0,roi.y),x1=Math.min(state.width,roi.x+roi.w),y1=Math.min(state.height,roi.y+roi.h);
  let graySum=0,signalSum=0,area=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const gray=grayAt(data,(y*state.width+x)*4);graySum+=gray;signalSum+=signalFromGray(gray,polarity);area++}
  const pad=Math.max(3,Math.round(Math.min(roi.w,roi.h)*Number($('#wbRing').value)/100));
  const bx0=Math.max(0,x0-pad),by0=Math.max(0,y0-pad),bx1=Math.min(state.width,x1+pad),by1=Math.min(state.height,y1+pad);
  let bgSum=0,bgSq=0,bgCount=0;
  for(let y=by0;y<by1;y++)for(let x=bx0;x<bx1;x++){if(x>=x0&&x<x1&&y>=y0&&y<y1)continue;const value=signalFromGray(grayAt(data,(y*state.width+x)*4),polarity);bgSum+=value;bgSq+=value*value;bgCount++}
  const background=bgCount?bgSum/bgCount:0;const bgSd=bgCount?Math.sqrt(Math.max(0,bgSq/bgCount-background*background)):0;
  const corrected=Math.max(0,signalSum-area*background);
  return {area,meanGray:area?graySum/area:0,rawIntegrated:signalSum,background,bgSd,corrected,correctedMean:area?corrected/area:0,pad};
}
function recalculate(){state.rois.forEach(roi=>roi.metrics=measureRoi(roi));renderAll()}
$('#wbPolarity').addEventListener('change',recalculate);$('#wbRing').addEventListener('input',event=>{$('#wbRingOut').textContent=`${event.target.value}%`;recalculate()});

function drawCanvas(){
  if(!state.imageData)return;const context=canvas.getContext('2d');context.putImageData(state.imageData,0,0);
  const line=Math.max(2,state.width/700),font=Math.max(12,state.width/70);context.lineWidth=line;context.font=`600 ${font}px sans-serif`;context.textBaseline='bottom';
  state.rois.forEach((roi,index)=>{const pad=roi.metrics.pad;context.setLineDash([line*3,line*2]);context.strokeStyle='rgba(255,208,120,.75)';context.strokeRect(roi.x-pad,roi.y-pad,roi.w+pad*2,roi.h+pad*2);context.setLineDash([]);context.strokeStyle='#a8b2ff';context.strokeRect(roi.x,roi.y,roi.w,roi.h);const label=`${index+1} · ${roi.label}`;const width=context.measureText(label).width;context.fillStyle='rgba(20,17,48,.82)';context.fillRect(roi.x,Math.max(0,roi.y-font-6),width+10,font+6);context.fillStyle='#eef0ff';context.fillText(label,roi.x+5,Math.max(font,roi.y-2))});
  if(state.drag){const rect=normalizedRect(state.drag.start,state.drag.end);context.setLineDash([line*4,line*2]);context.strokeStyle='#fff';context.strokeRect(rect.x,rect.y,rect.w,rect.h);context.setLineDash([])}
}
function referenceRoi(){return state.rois.find(roi=>String(roi.id)===$('#wbReference').value)}
function renderAll(){drawCanvas();renderReference();renderTable();const avg=state.rois.length?state.rois.reduce((sum,roi)=>sum+roi.metrics.area,0)/state.rois.length:0;$('#wbCount').textContent=state.rois.length;$('#wbAvgArea').textContent=state.rois.length?Math.round(avg).toLocaleString():'—';$('#wbViewerInfo').textContent=state.rois.length?`${state.rois.length} 条记录 · ${state.width} × ${state.height} px`:'等待框选'}
function renderReference(){const select=$('#wbReference'),current=select.value;select.innerHTML='<option value="">未选择</option>'+state.rois.map((roi,index)=>`<option value="${roi.id}">${index+1}. ${escapeHtml(roi.label)}</option>`).join('');if(state.rois.some(roi=>String(roi.id)===current))select.value=current;const ref=referenceRoi();$('#wbRefName').textContent=ref?ref.label:'—'}
function renderTable(){
  const body=$('#wbRows'),ref=referenceRoi(),denominator=ref?.metrics.corrected||0;
  if(!state.rois.length){body.innerHTML='<tr><td colspan="9">在图像中框选条带后显示结果</td></tr>';return}
  body.innerHTML=state.rois.map((roi,index)=>`<tr><td>${index+1}</td><td><input data-label-id="${roi.id}" value="${escapeHtml(roi.label)}"></td><td>${roi.metrics.area}</td><td>${roi.metrics.meanGray.toFixed(2)}</td><td>${roi.metrics.background.toFixed(2)}</td><td>${roi.metrics.corrected.toFixed(2)}</td><td>${roi.metrics.correctedMean.toFixed(3)}</td><td>${denominator?(roi.metrics.corrected/denominator).toFixed(3):'—'}</td><td><button class="row-delete" data-delete-id="${roi.id}" type="button">删除</button></td></tr>`).join('');
  body.querySelectorAll('[data-label-id]').forEach(input=>input.addEventListener('change',()=>{const roi=state.rois.find(item=>String(item.id)===input.dataset.labelId);if(roi){roi.label=input.value.trim()||roi.label;renderAll()}}));
  body.querySelectorAll('[data-delete-id]').forEach(button=>button.addEventListener('click',()=>{state.rois=state.rois.filter(item=>String(item.id)!==button.dataset.deleteId);renderAll()}));
}
function escapeHtml(value){return value.replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]))}
$('#wbReference').addEventListener('change',renderAll);$('#wbUndo').addEventListener('click',()=>{state.rois.pop();renderAll()});$('#wbClear').addEventListener('click',()=>{state.rois=[];renderAll()});
$('#wbReset').addEventListener('click',()=>{$('#wbFile').value='';state.imageData=null;state.rois=[];$('#wbWorkspace').hidden=true;$('#wbUpload').hidden=false});

$('#wbCsv').addEventListener('click',()=>{if(!state.rois.length)return toast('请先框选至少一条条带');const ref=referenceRoi(),den=ref?.metrics.corrected||0;const head='index,label,x,y,width,height,area_px,mean_raw_gray,raw_integrated_signal,local_background_signal,background_sd,corrected_integrated_density,corrected_mean_intensity,normalized_to_reference';const rows=state.rois.map((roi,index)=>[index+1,csvCell(roi.label),roi.x,roi.y,roi.w,roi.h,roi.metrics.area,roi.metrics.meanGray.toFixed(6),roi.metrics.rawIntegrated.toFixed(6),roi.metrics.background.toFixed(6),roi.metrics.bgSd.toFixed(6),roi.metrics.corrected.toFixed(6),roi.metrics.correctedMean.toFixed(6),den?(roi.metrics.corrected/den).toFixed(6):''].join(','));downloadText('\ufeff'+head+'\n'+rows.join('\n'),resultName('_wb_densitometry.csv'),'text/csv;charset=utf-8')});
$('#wbPng').addEventListener('click',()=>{if(!state.rois.length)return toast('请先框选至少一条条带');drawCanvas();canvas.toBlob(blob=>downloadBlob(blob,resultName('_wb_rois.png')),'image/png')});
$('#wbMethods').addEventListener('click',()=>{const text=`Western blot densitometry parameters\n\nImage: ${state.file?.name||''}\nSignal polarity: ${$('#wbPolarity').value}\nLocal background ring: ${$('#wbRing').value}% of the shorter ROI dimension\nNumber of ROIs: ${state.rois.length}\n\nMethod: Rectangular regions of interest were manually placed over each band using the browser-based Discovery Lab WB densitometry tool. Signal intensity was defined as ${$('#wbPolarity').value==='dark'?'255 minus grayscale intensity':'grayscale intensity'}. Local background was estimated from the rectangular ring surrounding each ROI. Background-corrected integrated density was calculated as raw integrated signal minus ROI area multiplied by mean local-background signal. Identically sized ROIs and images acquired within the linear exposure range were used for comparisons.\n`;downloadText(text,resultName('_wb_methods.txt'),'text/plain;charset=utf-8')});
function csvCell(value){return `"${String(value).replaceAll('"','""')}"`}
function resultName(suffix){return (state.file?.name||'image').replace(/\.[^.]+$/,'')+suffix}
function downloadText(content,name,type){downloadBlob(new Blob([content],{type}),name)}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
