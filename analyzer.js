const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  file: null,
  imageData: null,
  width: 0,
  height: 0,
  analysis: null,
  mode: 'auto',
  view: 'overlay',
  canvases: {}
};

const uploadCard = $('#uploadCard');
const imageInput = $('#imageInput');
const workspace = $('#workspace');
const resultCanvas = $('#resultCanvas');

$('#chooseButton').addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', event => event.target.files[0] && loadFile(event.target.files[0]));
['dragenter', 'dragover'].forEach(name => uploadCard.addEventListener(name, event => {
  event.preventDefault();
  uploadCard.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(name => uploadCard.addEventListener(name, event => {
  event.preventDefault();
  uploadCard.classList.remove('dragging');
}));
uploadCard.addEventListener('drop', event => {
  const file = event.dataTransfer.files[0];
  if (file) loadFile(file);
});

function showToast(message) {
  let toast = $('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

async function loadFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showToast('请选择 PNG、JPEG 或 WebP 图像');
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 24000000) {
      bitmap.close();
      return showToast('图像超过 2400 万像素，请先转换为较小的 PNG 图像');
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    state.file = file;
    state.width = canvas.width;
    state.height = canvas.height;
    state.imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    state.canvases.original = canvas;
    state.analysis = null;
    state.view = 'original';

    $('#fileName').textContent = file.name;
    $('#fileMeta').textContent = `${canvas.width} × ${canvas.height} px · ${formatBytes(file.size)}`;
    drawThumbnail(canvas);
    uploadCard.hidden = true;
    workspace.hidden = false;
    $('#resultsPanel').hidden = true;
    setWorkflow(2);
    setActiveView('original');
    showToast('图像已载入，请确认参数后运行分析');
  } catch (error) {
    console.error(error);
    showToast('无法读取该图像，请转换为 PNG 或 JPEG 后重试');
  }
}

function formatBytes(bytes) {
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

function drawThumbnail(source) {
  const canvas = $('#thumbCanvas');
  canvas.width = 96; canvas.height = 84;
  const scale = Math.max(canvas.width / source.width, canvas.height / source.height);
  const width = source.width * scale, height = source.height * scale;
  canvas.getContext('2d').drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

$('#resetButton').addEventListener('click', () => {
  imageInput.value = '';
  workspace.hidden = true;
  uploadCard.hidden = false;
  state.file = null;
  setWorkflow(1);
});

$('#bgPercentile').addEventListener('input', event => $('#bgOutput').textContent = `${event.target.value}%`);
$('#minArea').addEventListener('input', event => $('#areaOutput').textContent = `${event.target.value} px`);
$('#manualThreshold').addEventListener('input', event => $('#thresholdOutput').textContent = event.target.value);

$$('.segmented button').forEach(button => button.addEventListener('click', () => {
  $$('.segmented button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  state.mode = button.dataset.mode;
  $('#manualWrap').hidden = state.mode !== 'manual';
}));

$$('.view-tabs button').forEach(button => button.addEventListener('click', () => setActiveView(button.dataset.view)));
function setActiveView(view) {
  if (!state.canvases[view]) view = 'original';
  state.view = view;
  $$('.view-tabs button').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  drawToDisplay(state.canvases[view]);
}

function drawToDisplay(source) {
  if (!source) return;
  resultCanvas.width = source.width;
  resultCanvas.height = source.height;
  resultCanvas.getContext('2d').drawImage(source, 0, 0);
}

function setWorkflow(step) {
  $$('.workflow .step').forEach((item, index) => item.classList.toggle('active', index < step));
}

$('#analyzeButton').addEventListener('click', () => {
  if (!state.imageData) return;
  $('#stageLoading').hidden = false;
  $('#analyzeButton').disabled = true;
  setTimeout(() => {
    try {
      state.analysis = analyzeImage();
      buildResultCanvases();
      renderResults();
      setActiveView($('#showMask').checked ? 'overlay' : 'original');
      $('#resultsPanel').hidden = false;
      setWorkflow(4);
      $('#resultsPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (state.analysis.saturation > 0.005) showToast(`注意：${(state.analysis.saturation * 100).toFixed(2)}% 的目标通道像素已饱和`);
    } catch (error) {
      console.error(error);
      showToast('分析失败，请尝试较小的图像或重新上传');
    } finally {
      $('#stageLoading').hidden = true;
      $('#analyzeButton').disabled = false;
    }
  }, 60);
});

function analyzeImage() {
  const rgba = state.imageData.data;
  const count = state.width * state.height;
  const requested = $('#channelSelect').value;
  const channel = requested === 'auto' ? detectChannel(rgba, count) : requested;
  const values = new Uint8Array(count);
  const rawHistogram = new Uint32Array(256);
  let saturated = 0;

  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const value = channelValue(rgba, p, channel);
    values[i] = value;
    rawHistogram[value] += 1;
    if (value === 255) saturated += 1;
  }

  const background = histogramPercentile(rawHistogram, count, Number($('#bgPercentile').value) / 100);
  const corrected = new Uint8Array(count);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < count; i++) {
    const value = Math.max(0, values[i] - background);
    corrected[i] = value;
    histogram[value] += 1;
  }
  const threshold = state.mode === 'auto' ? Math.max(1, otsuThreshold(histogram, count)) : Number($('#manualThreshold').value);
  const initialMask = new Uint8Array(count);
  for (let i = 0; i < count; i++) initialMask[i] = corrected[i] > threshold ? 1 : 0;

  const { mask, objects } = removeSmallObjects(initialMask, state.width, state.height, Number($('#minArea').value));
  let positivePixels = 0, correctedSum = 0, rawSum = 0, correctedMax = 0;
  let bgCount = 0, bgSum = 0, bgSumSquares = 0;
  const signalHistogram = new Uint32Array(256);

  for (let i = 0; i < count; i++) {
    if (mask[i]) {
      positivePixels += 1;
      correctedSum += corrected[i];
      rawSum += values[i];
      correctedMax = Math.max(correctedMax, corrected[i]);
      signalHistogram[corrected[i]] += 1;
    } else if (corrected[i] <= threshold) {
      bgCount += 1;
      bgSum += values[i];
      bgSumSquares += values[i] * values[i];
    }
  }
  const rawMean = positivePixels ? rawSum / positivePixels : 0;
  const mean = positivePixels ? correctedSum / positivePixels : 0;
  const bgMean = bgCount ? bgSum / bgCount : background;
  const bgVariance = bgCount ? Math.max(0, bgSumSquares / bgCount - bgMean * bgMean) : 0;
  const bgSd = Math.sqrt(bgVariance);
  const snr = bgSd > 0 ? (rawMean - bgMean) / bgSd : 0;

  return {
    channel, values, corrected, mask, signalHistogram, background, threshold, objects,
    positivePixels, mean, rawMean, integratedDensity: correctedSum,
    areaFraction: positivePixels / count, snr, bgMean, bgSd,
    saturation: saturated / count, correctedMax
  };
}

function channelValue(data, offset, channel) {
  if (channel === 'red') return data[offset];
  if (channel === 'green') return data[offset + 1];
  if (channel === 'blue') return data[offset + 2];
  return Math.round(.2126 * data[offset] + .7152 * data[offset + 1] + .0722 * data[offset + 2]);
}

function detectChannel(data, count) {
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    histograms[0][data[p]] += 1; histograms[1][data[p + 1]] += 1; histograms[2][data[p + 2]] += 1;
  }
  const scores = histograms.map(hist => histogramPercentile(hist, count, .995) - histogramPercentile(hist, count, .2));
  return ['red', 'green', 'blue'][scores.indexOf(Math.max(...scores))];
}

function histogramPercentile(histogram, total, fraction) {
  const target = total * fraction;
  let cumulative = 0;
  for (let i = 0; i < 256; i++) {
    cumulative += histogram[i];
    if (cumulative >= target) return i;
  }
  return 255;
}

function otsuThreshold(histogram, total) {
  let totalSum = 0;
  for (let i = 0; i < 256; i++) totalSum += i * histogram[i];
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, threshold = 0;
  for (let i = 0; i < 256; i++) {
    backgroundWeight += histogram[i];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += i * histogram[i];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) { bestVariance = variance; threshold = i; }
  }
  return threshold;
}

function removeSmallObjects(source, width, height, minimumArea) {
  const count = width * height;
  const visited = new Uint8Array(count);
  const mask = new Uint8Array(count);
  const queue = new Int32Array(count);
  let objects = 0;
  for (let start = 0; start < count; start++) {
    if (!source[start] || visited[start]) continue;
    let head = 0, tail = 1;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      const left = index - 1, right = index + 1, up = index - width, down = index + width;
      if (x > 0 && source[left] && !visited[left]) { visited[left] = 1; queue[tail++] = left; }
      if (x + 1 < width && source[right] && !visited[right]) { visited[right] = 1; queue[tail++] = right; }
      if (y > 0 && source[up] && !visited[up]) { visited[up] = 1; queue[tail++] = up; }
      if (y + 1 < height && source[down] && !visited[down]) { visited[down] = 1; queue[tail++] = down; }
    }
    if (tail >= minimumArea) {
      objects += 1;
      for (let i = 0; i < tail; i++) mask[queue[i]] = 1;
    }
  }
  return { mask, objects };
}

function buildResultCanvases() {
  const { width, height } = state;
  const { mask } = state.analysis;
  const original = state.imageData.data;
  const overlayData = new ImageData(new Uint8ClampedArray(original), width, height);
  const maskData = new ImageData(width, height);
  for (let index = 0, p = 0; index < mask.length; index++, p += 4) {
    if (mask[index]) {
      overlayData.data[p] = Math.round(original[p] * .42 + 32);
      overlayData.data[p + 1] = Math.round(original[p + 1] * .5 + 128);
      overlayData.data[p + 2] = Math.round(original[p + 2] * .45 + 92);
      const x = index % width, y = (index / width) | 0;
      const boundary = x === 0 || y === 0 || x + 1 === width || y + 1 === height || !mask[index - 1] || !mask[index + 1] || !mask[index - width] || !mask[index + width];
      if (boundary) { overlayData.data[p] = 70; overlayData.data[p + 1] = 255; overlayData.data[p + 2] = 200; }
      maskData.data[p] = 102; maskData.data[p + 1] = 237; maskData.data[p + 2] = 194; maskData.data[p + 3] = 255;
    } else {
      maskData.data[p] = 3; maskData.data[p + 1] = 12; maskData.data[p + 2] = 11; maskData.data[p + 3] = 255;
    }
  }
  state.canvases.overlay = imageDataCanvas(overlayData);
  state.canvases.mask = imageDataCanvas(maskData);
}

function imageDataCanvas(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width; canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}

function renderResults() {
  const a = state.analysis;
  $('#metricMean').textContent = formatNumber(a.mean, 2);
  $('#metricIntDen').textContent = compactNumber(a.integratedDensity);
  $('#metricArea').textContent = `${(a.areaFraction * 100).toFixed(2)}%`;
  $('#metricSnr').textContent = formatNumber(a.snr, 2);
  $('#detailChannel').textContent = channelLabel(a.channel);
  $('#detailBg').textContent = `${formatNumber(a.background, 1)} a.u.`;
  $('#detailThreshold').textContent = `${formatNumber(a.threshold, 0)} a.u.（扣背景后）`;
  $('#detailObjects').textContent = a.objects.toLocaleString('zh-CN');
  $('#detailPixels').textContent = a.positivePixels.toLocaleString('zh-CN');
  $('#detailSize').textContent = `${state.width} × ${state.height} px`;
  $('#viewerInfo').textContent = `${channelLabel(a.channel)} · 阈值 ${a.threshold} · ${a.objects} 个区域`;
  drawHistogram(a.signalHistogram, a.positivePixels, a.threshold);
}

function channelLabel(channel) {
  return { red: '红色通道 (R)', green: '绿色通道 (G)', blue: '蓝色通道 (B)', gray: '灰度' }[channel];
}
function formatNumber(value, digits) { return Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '0'; }
function compactNumber(value) { return Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 3 }).format(value); }

function drawHistogram(histogram, total, threshold) {
  const canvas = $('#histogramCanvas');
  const context = canvas.getContext('2d');
  const width = canvas.width, height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = 'rgba(160,205,193,.1)'; context.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const y = 15 + i * 55; context.beginPath(); context.moveTo(0,y); context.lineTo(width,y); context.stroke(); }
  const bins = 64, grouped = new Array(bins).fill(0);
  histogram.forEach((value, index) => grouped[Math.min(bins - 1, Math.floor(index / 4))] += value);
  const max = Math.max(1, ...grouped);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(102,237,194,.75)'); gradient.addColorStop(1, 'rgba(102,237,194,.08)');
  context.fillStyle = gradient;
  grouped.forEach((value, index) => {
    const barHeight = value / max * (height - 28);
    context.fillRect(index * width / bins + 1, height - barHeight - 10, width / bins - 2, barHeight);
  });
  const x = threshold / 255 * width;
  context.strokeStyle = '#ffd078'; context.setLineDash([5,4]); context.beginPath(); context.moveTo(x,8); context.lineTo(x,height-8); context.stroke(); context.setLineDash([]);
}

$('#showMask').addEventListener('change', event => setActiveView(event.target.checked ? 'overlay' : 'original'));

$('#downloadCsv').addEventListener('click', () => {
  const a = state.analysis;
  const headers = ['file','width_px','height_px','channel','background_percentile','background_intensity_au','threshold_mode','threshold_corrected_au','minimum_area_px','positive_objects','positive_pixels','positive_area_percent','mean_fluorescence_corrected_au','raw_signal_mean_au','integrated_density_corrected_au','background_mean_au','background_sd_au','snr','saturated_pixels_percent'];
  const values = [state.file.name,state.width,state.height,a.channel,$('#bgPercentile').value,a.background,state.mode,a.threshold,$('#minArea').value,a.objects,a.positivePixels,(a.areaFraction*100).toFixed(6),a.mean.toFixed(6),a.rawMean.toFixed(6),a.integratedDensity.toFixed(2),a.bgMean.toFixed(6),a.bgSd.toFixed(6),a.snr.toFixed(6),(a.saturation*100).toFixed(6)];
  downloadBlob('\ufeff' + headers.join(',') + '\n' + values.map(csvCell).join(','), resultName('.csv'), 'text/csv;charset=utf-8');
});

$('#downloadImage').addEventListener('click', () => {
  state.canvases.overlay.toBlob(blob => downloadBlob(blob, resultName('_overlay.png'), 'image/png'), 'image/png');
});

$('#downloadMethods').addEventListener('click', () => {
  const a = state.analysis;
  const text = `免疫荧光定量方法（参数记录）\n\n中文：使用 Discovery Lab 浏览器端免疫荧光分析工具对图像进行全图定量。图像经浏览器解码为 8-bit RGB 数据，提取${channelLabel(a.channel)}。以像素强度第 ${$('#bgPercentile').value} 百分位数（${a.background} a.u.）估计均匀背景并逐像素扣除。采用${state.mode === 'auto' ? 'Otsu 自动阈值法' : '手动阈值法'}（背景扣除后阈值 = ${a.threshold} a.u.）分割阳性信号，去除面积小于 ${$('#minArea').value} 像素的连通区域。报告背景扣除后的平均荧光强度、积分密度、阳性面积比例及信噪比。\n\nEnglish: Whole-image immunofluorescence quantification was performed using the browser-based Discovery Lab fluorescence analyzer. Images were browser-decoded to 8-bit RGB data, and the ${a.channel} channel was extracted. Uniform background was estimated as the ${ordinal($('#bgPercentile').value)} percentile of pixel intensity (${a.background} a.u.) and subtracted pixel-wise. Positive signal was segmented using ${state.mode === 'auto' ? "Otsu's automatic threshold" : 'a manually selected threshold'} (${a.threshold} a.u. after background subtraction). Connected regions smaller than ${$('#minArea').value} pixels were excluded. Background-corrected mean fluorescence intensity, integrated density, positive area fraction, and signal-to-noise ratio were reported.\n\n图像：${state.file.name}\n分析时间：${new Date().toISOString()}\n饱和像素：${(a.saturation*100).toFixed(4)}%\n`;
  downloadBlob(text, resultName('_methods.txt'), 'text/plain;charset=utf-8');
});

function ordinal(value) {
  const n = Number(value), mod100 = n % 100;
  return `${n}${mod100 >= 11 && mod100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'}[n%10] || 'th')}`;
}
function csvCell(value) { const string = String(value); return /[",\n]/.test(string) ? `"${string.replaceAll('"','""')}"` : string; }
function resultName(suffix) { return state.file.name.replace(/\.[^.]+$/, '') + suffix; }
function downloadBlob(content, name, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
