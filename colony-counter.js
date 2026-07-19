const $ = selector => document.querySelector(selector);

const plateLayouts = {
  dish: { rows: 1, cols: 1, diameterMm: 90 },
  6: { rows: 2, cols: 3, diameterMm: 34.8 },
  12: { rows: 3, cols: 4, diameterMm: 22.1 },
  24: { rows: 4, cols: 6, diameterMm: 15.6 },
  48: { rows: 6, cols: 8, diameterMm: 11.0 },
  96: { rows: 8, cols: 12, diameterMm: 6.4 }
};

const state = {
  file: null, imageData: null, width: 0, height: 0,
  auto: [], manual: [], removed: new Set(), analysis: null, nextManual: 1
};
const canvas = $('#colonyCanvas');

function toast(message) {
  const box = $('#colonyToast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('show'), 2700);
}
function formatBytes(bytes) { return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function detections() { return [...state.auto.filter(item => !state.removed.has(item.id)), ...state.manual]; }
function isMultiwell() { return $('#containerType').value !== 'dish'; }
function isPlaqueMode() { return $('#objectMode').value === 'plaque'; }

function currentLayout() {
  const type = $('#containerType').value;
  const base = plateLayouts[type] || plateLayouts.dish;
  const rotated = type !== 'dish' && $('#plateOrientation').value === 'portrait';
  return { type, rows: rotated ? base.cols : base.rows, cols: rotated ? base.rows : base.cols, baseRows: base.rows, baseCols: base.cols, rotated, diameterMm: base.diameterMm };
}

function analysisRegions() {
  if (!state.width || !state.height) return [];
  const layout = currentLayout();
  const cx = state.width * Number($('#plateX').value) / 100;
  const cy = state.height * Number($('#plateY').value) / 100;
  const regionWidth = state.width * Number($('#regionWidth').value) / 100;
  const regionHeight = state.height * Number($('#regionHeight').value) / 100;
  if (layout.type === 'dish') {
    return [{ label: 'Dish', row: 0, col: 0, cx, cy, r: Math.min(regionWidth, regionHeight) / 2 }];
  }
  const cellWidth = regionWidth / layout.cols;
  const cellHeight = regionHeight / layout.rows;
  const radius = Math.min(cellWidth, cellHeight) * Number($('#wellScale').value) / 200;
  const left = cx - regionWidth / 2;
  const top = cy - regionHeight / 2;
  const regions = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      const physicalRow = layout.rotated ? layout.baseRows - 1 - col : row;
      const physicalCol = layout.rotated ? row : col;
      regions.push({
        label: `${String.fromCharCode(65 + physicalRow)}${physicalCol + 1}`, row, col,
        cx: left + (col + .5) * cellWidth,
        cy: top + (row + .5) * cellHeight,
        r: radius
      });
    }
  }
  return regions;
}

function regionAtPoint(x, y, regions = analysisRegions()) {
  return regions.find(region => (x - region.cx) ** 2 + (y - region.cy) ** 2 <= region.r ** 2) || null;
}

$('#colonyChoose').addEventListener('click', () => $('#colonyFile').click());
$('#colonyFile').addEventListener('change', event => event.target.files[0] && loadImage(event.target.files[0]));
const drop = $('#colonyUpload');
['dragenter', 'dragover'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('dragging'); }));
drop.addEventListener('drop', event => event.dataTransfer.files[0] && loadImage(event.dataTransfer.files[0]));

async function loadImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('请选择 PNG、JPEG 或 WebP 图像');
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    state.width = Math.max(1, Math.round(bitmap.width * scale));
    state.height = Math.max(1, Math.round(bitmap.height * scale));
    const source = document.createElement('canvas');
    source.width = state.width; source.height = state.height;
    const context = source.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, state.width, state.height);
    const originalWidth = bitmap.width, originalHeight = bitmap.height;
    bitmap.close();
    state.file = file;
    state.imageData = context.getImageData(0, 0, state.width, state.height);
    resetResults();
    canvas.width = state.width; canvas.height = state.height;
    $('#colonyFileName').textContent = file.name;
    $('#colonyFileMeta').textContent = `${originalWidth} × ${originalHeight} px · ${formatBytes(file.size)}`;
    $('#analysisSize').textContent = `${state.width} × ${state.height}`;
    drawThumb(source);
    $('#colonyUpload').hidden = true;
    $('#colonyWorkspace').hidden = false;
    renderAll();
    toast(scale < 1 ? '图像已缩放用于快速分析，请先对齐所有孔位' : '图像已载入，请先对齐所有孔位');
  } catch (error) {
    console.error(error);
    toast('无法读取图像，请转换为 PNG 或 JPEG 后重试');
  }
}

function drawThumb(source) {
  const thumb = $('#colonyThumb');
  thumb.width = 92; thumb.height = 78;
  const scale = Math.max(thumb.width / source.width, thumb.height / source.height);
  const width = source.width * scale, height = source.height * scale;
  thumb.getContext('2d').drawImage(source, (thumb.width - width) / 2, (thumb.height - height) / 2, width, height);
}

function resetResults() {
  state.auto = [];
  state.manual = [];
  state.removed = new Set();
  state.analysis = null;
  state.nextManual = 1;
}

function geometryChanged() {
  if (state.analysis) resetResults();
  $('#countStatus').textContent = '布局已更改 · 请重新计数';
  renderAll();
}

const geometryOutputs = {
  regionWidth: 'regionWidthOut', regionHeight: 'regionHeightOut',
  plateX: 'plateXOut', plateY: 'plateYOut', wellScale: 'wellScaleOut'
};
Object.entries(geometryOutputs).forEach(([id, output]) => {
  $('#' + id).addEventListener('input', event => {
    $('#' + output).textContent = `${event.target.value}%`;
    geometryChanged();
  });
});

$('#containerType').addEventListener('change', configureContainer);
$('#plateOrientation').addEventListener('change', geometryChanged);
function configureContainer() {
  const layout = currentLayout();
  const multi = layout.type !== 'dish';
  $('#wellScaleField').hidden = !multi;
  $('#plateOrientation').disabled = !multi;
  $('#regionWidth').value = multi ? 84 : 92;
  $('#regionHeight').value = multi ? 84 : 92;
  $('#regionWidthOut').textContent = `${$('#regionWidth').value}%`;
  $('#regionHeightOut').textContent = `${$('#regionHeight').value}%`;
  $('#plateDiameterMm').value = layout.diameterMm;
  $('#physicalDiameterLabel').textContent = multi ? '单孔直径（mm）' : '培养皿直径（mm）';
  $('#volumeLabel').textContent = multi ? '每孔接种体积（mL）' : '接种体积（mL）';
  $('#concentrationLabel').textContent = multi ? '平均每孔估算浓度' : '估算原液浓度';
  $('#meanCountLabel').textContent = multi ? '平均每孔计数' : '平均直径';
  $('#meanCountUnit').textContent = multi ? `${layout.rows * layout.cols} 孔平均` : '分析图像像素';
  geometryChanged();
}
configureContainer();

$('#thresholdOffset').addEventListener('input', event => { $('#thresholdOffsetOut').textContent = event.target.value; markDirty(); });
['minDiameter', 'maxDiameter', 'roundness', 'skipUnstained'].forEach(id => $('#' + id).addEventListener('change', markDirty));
$('#peakSpacing').addEventListener('input', event => { $('#peakSpacingOut').textContent = `${event.target.value} px`; markDirty(); });
$('#stainCutoff').addEventListener('input', event => { $('#stainCutoffOut').textContent = event.target.value; markDirty(); });
$('#objectMode').addEventListener('change', applyModePreset);
function applyModePreset() {
  const plaque = isPlaqueMode();
  $('#plaqueFilters').hidden = !plaque;
  $('#componentFilters').hidden = plaque;
  $('#thresholdOffset').value = plaque ? 20 : 0;
  $('#thresholdOffsetOut').textContent = $('#thresholdOffset').value;
  $('#modeHelp').textContent = plaque
    ? '专门识别结晶紫或蓝紫细胞层中的高亮微小白点'
    : ($('#objectMode').value === 'light' ? '按灰度识别浅色、彼此分离的较大对象' : '按灰度识别浅色培养基上的深色菌落');
  if (state.analysis) resetResults();
  renderAll();
}
applyModePreset();
function markDirty() { if (state.analysis) $('#countStatus').textContent = '参数已更改 · 请重新计数'; }

$('#countButton').addEventListener('click', () => {
  if (!state.imageData) return;
  $('#countBusy').hidden = false;
  $('#countButton').disabled = true;
  setTimeout(() => {
    try {
      runCounting();
      toast(`自动识别完成：${state.auto.length} 个对象，${analysisRegions().length} 个分析区`);
    } catch (error) {
      console.error(error);
      toast('计数失败，请调整参数或使用较小图像');
    } finally {
      $('#countBusy').hidden = true;
      $('#countButton').disabled = false;
    }
  }, 50);
});

function buildRegionMap(regions) {
  const map = new Uint16Array(state.width * state.height);
  regions.forEach((region, regionIndex) => {
    const x0 = Math.max(0, Math.floor(region.cx - region.r));
    const x1 = Math.min(state.width - 1, Math.ceil(region.cx + region.r));
    const y0 = Math.max(0, Math.floor(region.cy - region.r));
    const y1 = Math.min(state.height - 1, Math.ceil(region.cy + region.r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - region.cx) ** 2 + (y - region.cy) ** 2 <= region.r ** 2) map[y * state.width + x] = regionIndex + 1;
      }
    }
  });
  return map;
}

function runCounting() {
  const regions = analysisRegions();
  const layout = currentLayout();
  const plaqueMode = isPlaqueMode();
  const count = state.width * state.height;
  const data = state.imageData.data;
  const values = new Uint8Array(count);
  const regionMap = buildRegionMap(regions);
  const histograms = regions.map(() => new Uint32Array(256));
  const totals = new Uint32Array(regions.length);
  const chromaSums = new Float64Array(regions.length);
  for (let index = 0; index < count; index++) {
    const p = index * 4;
    const red = data[p], green = data[p + 1], blue = data[p + 2];
    const value = plaqueMode ? Math.min(red, green, blue) : Math.round(.2126 * red + .7152 * green + .0722 * blue);
    values[index] = value;
    const regionCode = regionMap[index];
    if (regionCode) {
      const regionIndex = regionCode - 1;
      histograms[regionIndex][value]++;
      totals[regionIndex]++;
      chromaSums[regionIndex] += Math.max(red, green, blue) - Math.min(red, green, blue);
    }
  }
  const meanChroma = regions.map((_, index) => totals[index] ? chromaSums[index] / totals[index] : 0);
  const skipUnstained = plaqueMode && $('#skipUnstained').checked;
  const stainCutoff = Number($('#stainCutoff').value);
  const active = regions.map((_, index) => !skipUnstained || meanChroma[index] >= stainCutoff);
  const offset = Number($('#thresholdOffset').value);
  const otsuValues = histograms.map((histogram, index) => otsuThreshold(histogram, totals[index]));
  const thresholds = otsuValues.map(value => clamp(value + offset, 1, 254));
  const dark = $('#objectMode').value === 'dark';
  const mask = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const regionCode = regionMap[index];
    if (regionCode && active[regionCode - 1]) mask[index] = dark ? values[index] < thresholds[regionCode - 1] : values[index] > thresholds[regionCode - 1];
  }
  const minDiameter = Math.max(1, Number($('#minDiameter').value));
  const maxDiameter = Math.max(minDiameter, Number($('#maxDiameter').value));
  const roundness = Number($('#roundness').value);
  state.auto = plaqueMode
    ? detectPeaks(values, regionMap, thresholds, regions, state.width, state.height, Number($('#peakSpacing').value), active)
    : detectComponents(mask, state.width, state.height, minDiameter, maxDiameter, roundness);
  state.auto.forEach((item, index) => {
    item.id = `auto_${index + 1}`;
    item.well = regionAtPoint(item.x, item.y, regions)?.label || '';
  });
  state.manual = [];
  state.removed = new Set();
  state.nextManual = 1;
  const average = array => array.reduce((sum, value) => sum + value, 0) / Math.max(1, array.length);
  const activeOtsu = otsuValues.filter((_, index) => active[index]);
  const activeThresholds = thresholds.filter((_, index) => active[index]);
  state.analysis = {
    automatic: state.auto.length, regions, rows: layout.rows, cols: layout.cols,
    mode: $('#objectMode').value, active, activeLabels: regions.filter((_, index) => active[index]).map(region => region.label),
    meanChroma, otsu: average(activeOtsu), threshold: average(activeThresholds), otsuValues, thresholds
  };
  renderAll();
}

function detectPeaks(values, regionMap, thresholds, regions, width, height, spacing, active) {
  const scoreCounts = new Uint32Array(256);
  let candidateCount = 0;
  for (let index = 0; index < values.length; index++) {
    const regionCode = regionMap[index];
    if (regionCode && active[regionCode - 1] && values[index] > thresholds[regionCode - 1]) {
      scoreCounts[values[index]]++;
      candidateCount++;
    }
  }
  const starts = new Uint32Array(256);
  for (let score = 1; score < 256; score++) starts[score] = starts[score - 1] + scoreCounts[score - 1];
  const cursors = starts.slice();
  const ordered = new Int32Array(candidateCount);
  for (let index = 0; index < values.length; index++) {
    const regionCode = regionMap[index];
    if (regionCode && active[regionCode - 1] && values[index] > thresholds[regionCode - 1]) ordered[cursors[values[index]]++] = index;
  }
  const blocked = new Uint8Array(values.length);
  const found = [];
  const radius = Math.max(1, Math.round(spacing));
  for (let order = ordered.length - 1; order >= 0; order--) {
    const index = ordered[order];
    if (blocked[index]) continue;
    const x = index % width, y = (index / width) | 0, regionIndex = regionMap[index] - 1;
    found.push({ x, y, area: 1, diameter: radius * 2 + 1, circularity: 1, score: values[index], well: regions[regionIndex].label, manual: false });
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) blocked[ny * width + nx] = 1;
      }
    }
  }
  return found;
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let bgWeight = 0, bgSum = 0, best = -1, threshold = 0;
  for (let i = 0; i < 256; i++) {
    bgWeight += histogram[i];
    if (!bgWeight) continue;
    const fgWeight = total - bgWeight;
    if (!fgWeight) break;
    bgSum += i * histogram[i];
    const bgMean = bgSum / bgWeight;
    const fgMean = (sum - bgSum) / fgWeight;
    const variance = bgWeight * fgWeight * (bgMean - fgMean) ** 2;
    if (variance > best) { best = variance; threshold = i; }
  }
  return threshold;
}

function detectComponents(mask, width, height, minDiameter, maxDiameter, minCircularity) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const found = [];
  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0, tail = 1, sumX = 0, sumY = 0, perimeter = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = (index / width) | 0;
      sumX += x; sumY += y;
      const neighbors = [[x - 1, y, index - 1], [x + 1, y, index + 1], [x, y - 1, index - width], [x, y + 1, index + width]];
      for (const [nx, ny, ni] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ni]) { perimeter++; continue; }
        if (!visited[ni]) { visited[ni] = 1; queue[tail++] = ni; }
      }
    }
    const diameter = 2 * Math.sqrt(tail / Math.PI);
    const circularity = perimeter ? 4 * Math.PI * tail / (perimeter * perimeter) : 0;
    if (diameter >= minDiameter && diameter <= maxDiameter && circularity >= minCircularity) {
      found.push({ x: sumX / tail, y: sumY / tail, area: tail, diameter, circularity, manual: false });
    }
  }
  return found;
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * state.width / rect.width, y: (event.clientY - rect.top) * state.height / rect.height };
}

canvas.addEventListener('click', event => {
  if (!state.analysis) return toast('请先运行自动计数');
  const point = pointFromEvent(event);
  const well = regionAtPoint(point.x, point.y);
  if (!well) return toast('点击位置在所有分析孔范围外');
  if (!state.analysis.activeLabels.includes(well.label)) return toast(`${well.label} 被判定为未染色空孔；如需分析请关闭“自动跳过”后重新计数`);
  const all = detections();
  let nearest = null, distance = Infinity;
  all.forEach(item => { const d = Math.hypot(item.x - point.x, item.y - point.y); if (d < distance) { distance = d; nearest = item; } });
  if (nearest && distance < Math.max(9, nearest.diameter * .75)) {
    if (nearest.manual) state.manual = state.manual.filter(item => item.id !== nearest.id);
    else state.removed.add(nearest.id);
    toast(`已删除 ${nearest.well || well.label} 中的识别点`);
  } else {
    const diameters = all.map(item => item.diameter).sort((a, b) => a - b);
    const diameter = diameters.length ? diameters[Math.floor(diameters.length / 2)] : Math.max(6, Number($('#minDiameter').value) * 1.5);
    state.manual.push({ id: `manual_${state.nextManual++}`, x: point.x, y: point.y, diameter, area: Math.PI * (diameter / 2) ** 2, circularity: 1, manual: true, well: well.label });
    toast(`已在 ${well.label} 手动添加一个计数点`);
  }
  renderAll();
});

function drawCanvas() {
  if (!state.imageData) return;
  const context = canvas.getContext('2d');
  context.putImageData(state.imageData, 0, 0);
  const regions = analysisRegions();
  const line = Math.max(1.5, state.width / 800);
  context.lineWidth = line * 1.3;
  context.font = `600 ${Math.max(10, state.width / 100)}px sans-serif`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  const activeLabels = new Set(state.analysis?.activeLabels || regions.map(region => region.label));
  regions.forEach(region => {
    context.setLineDash([line * 5, line * 3]);
    context.strokeStyle = activeLabels.has(region.label) ? 'rgba(255,208,120,.9)' : 'rgba(150,155,180,.5)';
    context.beginPath(); context.arc(region.cx, region.cy, region.r, 0, Math.PI * 2); context.stroke();
    context.setLineDash([]);
    if (isMultiwell()) {
      context.fillStyle = 'rgba(20,17,48,.76)';
      const labelY = region.cy - region.r + Math.max(10, state.width / 100);
      context.fillRect(region.cx - 13, labelY - 7, 26, 14);
      context.fillStyle = activeLabels.has(region.label) ? '#f0e7bf' : '#9196aa';
      context.fillText(activeLabels.has(region.label) ? region.label : `${region.label}×`, region.cx, labelY);
    }
  });
  detections().forEach(item => {
    context.lineWidth = line;
    context.strokeStyle = item.manual ? '#ffd078' : '#a8b2ff';
    context.fillStyle = item.manual ? 'rgba(255,208,120,.10)' : 'rgba(168,178,255,.10)';
    context.beginPath(); context.arc(item.x, item.y, Math.max(3, item.diameter / 2), 0, Math.PI * 2); context.fill(); context.stroke();
  });
}

function countsByWell(regions = analysisRegions()) {
  const counts = Object.fromEntries(regions.map(region => [region.label, 0]));
  detections().forEach(item => { if (Object.hasOwn(counts, item.well)) counts[item.well]++; });
  return counts;
}

function renderWellSummary() {
  const summary = $('#wellSummary');
  if (!isMultiwell()) { summary.hidden = true; return; }
  summary.hidden = false;
  const layout = currentLayout(), regions = analysisRegions(), counts = countsByWell(regions);
  const activeLabels = new Set(state.analysis?.activeLabels || regions.map(region => region.label));
  const values = regions.filter(region => activeLabels.has(region.label)).map(region => counts[region.label]);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  $('#wellSummaryText').textContent = `${values.length}/${regions.length} 个有效孔 · 平均 ${average.toFixed(2)} 个/孔 · 范围 ${values.length ? Math.min(...values) : 0}–${values.length ? Math.max(...values) : 0}`;
  const grid = $('#wellCountGrid');
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0, 1fr))`;
  grid.innerHTML = regions.map(region => activeLabels.has(region.label)
    ? `<span class="${counts[region.label] > average && average ? 'high' : ''}">${region.label}<b>${counts[region.label]}</b></span>`
    : `<span class="skipped">${region.label}<b>跳过</b></span>`).join('');
}

function renderAll() {
  drawCanvas();
  const all = detections(), count = all.length;
  const avgDiameter = count ? all.reduce((sum, item) => sum + item.diameter, 0) / count : 0;
  const regions = analysisRegions();
  const activeCount = state.analysis?.activeLabels.length || regions.length;
  const meanPerWell = count / Math.max(1, activeCount);
  $('#totalObjects').textContent = count.toLocaleString();
  $('#averageDiameter').textContent = count ? (isMultiwell() ? meanPerWell.toFixed(2) : (isPlaqueMode() ? `${$('#peakSpacing').value} px` : `${avgDiameter.toFixed(1)} px`)) : '—';
  $('#autoCount').textContent = state.analysis?.automatic || 0;
  $('#manualAdded').textContent = state.manual.length;
  $('#manualRemoved').textContent = state.removed.size;
  $('#otsuValue').textContent = state.analysis ? state.analysis.otsu.toFixed(1) : '—';
  $('#appliedThreshold').textContent = state.analysis ? state.analysis.threshold.toFixed(1) : '—';
  $('#countStatus').textContent = state.analysis ? `${count.toLocaleString()} 个 · ${activeCount}/${regions.length} 个有效分析区` : '等待分析';
  $('#colonyViewerInfo').textContent = isMultiwell()
    ? `${currentLayout().rows} × ${currentLayout().cols} 孔 · 区域 ${$('#regionWidth').value}% × ${$('#regionHeight').value}%`
    : `培养皿 · 区域 ${$('#regionWidth').value}% × ${$('#regionHeight').value}%`;
  renderWellSummary();
  updateCalculations();
}

function calculationValues() {
  const count = detections().length;
  const totalRegionCount = Math.max(1, analysisRegions().length);
  const wellCount = Math.max(1, state.analysis?.activeLabels.length || totalRegionCount);
  const diameterMm = Number($('#plateDiameterMm').value);
  const volume = Number($('#platedVolume').value);
  const exponent = Number($('#dilutionExponent').value);
  const combinedAreaCm2 = wellCount * Math.PI * (diameterMm / 20) ** 2;
  const basisCount = isMultiwell() ? count / wellCount : count;
  return {
    count, wellCount, totalRegionCount, basisCount,
    density: combinedAreaCm2 > 0 ? count / combinedAreaCm2 : 0,
    concentration: volume > 0 ? basisCount / (volume * 10 ** exponent) : 0,
    diameterMm, volume, exponent
  };
}

function updateCalculations() {
  const result = calculationValues();
  $('#plateDensity').textContent = result.count && Number.isFinite(result.density) ? result.density.toFixed(2) : '—';
  $('#cultureConcentration').textContent = result.count && Number.isFinite(result.concentration) ? result.concentration.toExponential(2) : '—';
  $('#dilutionExample').textContent = `当前：10${superscript(result.exponent)}`;
}
function superscript(value) { return String(value).replace(/-/g, '⁻').replace(/[0-9]/g, digit => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]); }
['plateDiameterMm', 'platedVolume'].forEach(id => $('#' + id).addEventListener('input', updateCalculations));
$('#dilutionExponent').addEventListener('input', updateCalculations);

$('#restoreCount').addEventListener('click', () => { state.manual = []; state.removed = new Set(); renderAll(); });
$('#clearCount').addEventListener('click', () => { state.removed = new Set(state.auto.map(item => item.id)); state.manual = []; renderAll(); });
$('#colonyReset').addEventListener('click', () => {
  $('#colonyFile').value = '';
  state.imageData = null;
  resetResults();
  $('#colonyWorkspace').hidden = true;
  $('#colonyUpload').hidden = false;
});

$('#colonyCsv').addEventListener('click', () => {
  if (!state.analysis) return toast('请先运行自动计数');
  const all = detections(), result = calculationValues(), layout = currentLayout(), perWell = countsByWell();
  const meta = [
    'metric,value', `file,${csvCell(state.file.name)}`, `container_type,${layout.type}`,
    `analysis_mode,${state.analysis.mode}`, `layout_rows,${layout.rows}`, `layout_columns,${layout.cols}`,
    `active_wells,${result.wellCount}`, `total_wells,${result.totalRegionCount}`,
    `total_count,${all.length}`, `mean_count_per_well,${(all.length / result.wellCount).toFixed(6)}`,
    `automatic_count,${state.analysis.automatic}`, `manual_added,${state.manual.length}`, `manual_removed,${state.removed.size}`,
    `mean_otsu_threshold,${state.analysis.otsu}`, `mean_applied_threshold,${state.analysis.threshold}`,
    `single_well_or_dish_diameter_mm,${result.diameterMm}`, `dilution_exponent,${result.exponent}`,
    `plated_volume_per_well_ml,${result.volume}`, `estimated_cfu_pfu_per_ml,${result.concentration}`
  ].join('\n');
  const wellRows = '\n\nwell,status,count,mean_rgb_chroma,otsu_threshold,applied_threshold\n' + state.analysis.regions.map((region, index) => `${region.label},${state.analysis.active[index] ? 'active' : 'skipped'},${perWell[region.label]},${state.analysis.meanChroma[index].toFixed(3)},${state.analysis.otsuValues[index]},${state.analysis.thresholds[index]}`).join('\n');
  const objectRows = '\n\nobject_id,well,type,x_px,y_px,diameter_or_spacing_px,area_px,circularity,peak_score\n' + all.map((item, index) => [index + 1, item.well || '', item.manual ? 'manual' : 'automatic', item.x.toFixed(3), item.y.toFixed(3), item.diameter.toFixed(3), item.area.toFixed(3), item.circularity.toFixed(4), item.score ?? ''].join(',')).join('\n');
  downloadText('\ufeff' + meta + wellRows + objectRows, resultName('_colony_plaque_count.csv'), 'text/csv;charset=utf-8');
});

$('#colonyPng').addEventListener('click', () => {
  if (!state.analysis) return toast('请先运行自动计数');
  drawCanvas();
  canvas.toBlob(blob => downloadBlob(blob, resultName('_counted.png')), 'image/png');
});

$('#colonyMethods').addEventListener('click', () => {
  if (!state.analysis) return toast('请先运行自动计数');
  const layout = currentLayout(), result = calculationValues();
  const detectionParameters = isPlaqueMode()
    ? `Peak separation: ${$('#peakSpacing').value} analysis pixels\nSkip unstained wells: ${$('#skipUnstained').checked}\nMinimum RGB chroma for stained wells: ${$('#stainCutoff').value}`
    : `Accepted diameter: ${$('#minDiameter').value}–${$('#maxDiameter').value} analysis pixels\nMinimum circularity: ${$('#roundness').value}`;
  const method = isPlaqueMode()
    ? `For dense white plaques on a blue/purple stained monolayer, pixel score was defined as the minimum of the red, green, and blue channel intensities. Bright candidate pixels above the per-well threshold were ranked by score and counted using non-maximum suppression with the specified minimum peak separation. Wells with mean RGB chroma below the staining cutoff were excluded as unstained wells.`
    : `Four-connected components were filtered by equivalent circular diameter and circularity.`;
  const text = `Colony/plaque counting parameters\n\nImage: ${state.file.name}\nContainer: ${layout.type === 'dish' ? 'Petri dish' : layout.type + '-well plate'}\nVisual layout: ${layout.rows} rows × ${layout.cols} columns\nAnalysis mode: ${state.analysis.mode}\nAnalysis region: ${$('#regionWidth').value}% width × ${$('#regionHeight').value}% height\nWell diameter within grid cell: ${$('#wellScale').value}%\nPlate center: X ${$('#plateX').value}%, Y ${$('#plateY').value}%\nActive wells: ${result.wellCount}/${result.totalRegionCount}\nMean Otsu threshold across active regions: ${state.analysis.otsu.toFixed(2)}\nMean applied threshold across active regions: ${state.analysis.threshold.toFixed(2)}\n${detectionParameters}\nFinal total after manual correction: ${detections().length}\nMean count per active well/region: ${(detections().length / result.wellCount).toFixed(3)}\n\nMethod: Circular analysis regions were manually aligned to the dish or individual wells using the browser-based Discovery Lab colony/plaque counter. Each active region was independently segmented using Otsu's threshold with a common user-defined offset. ${method} Detections were assigned to their corresponding well. All detections were visually reviewed per well, and false-positive or missed objects were manually corrected. For multiwell plates, estimated titer used the mean count per active well and assumed identical dilution and plated volume across replicate wells.\n`;
  downloadText(text, resultName('_counting_methods.txt'), 'text/plain;charset=utf-8');
});

function csvCell(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function resultName(suffix) { return (state.file?.name || 'plate').replace(/\.[^.]+$/, '') + suffix; }
function downloadText(content, name, type) { downloadBlob(new Blob([content], { type }), name); }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
