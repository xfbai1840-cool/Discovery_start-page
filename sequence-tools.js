const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const codonTable = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',TCT:'S',TCC:'S',TCA:'S',TCG:'S',TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',TGT:'C',TGC:'C',TGA:'*',TGG:'W',
  CTT:'L',CTC:'L',CTA:'L',CTG:'L',CCT:'P',CCC:'P',CCA:'P',CCG:'P',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',ACT:'T',ACC:'T',ACA:'T',ACG:'T',AAT:'N',AAC:'N',AAA:'K',AAG:'K',AGT:'S',AGC:'S',AGA:'R',AGG:'R',
  GTT:'V',GTC:'V',GTA:'V',GTG:'V',GCT:'A',GCC:'A',GCA:'A',GCG:'A',GAT:'D',GAC:'D',GAA:'E',GAG:'E',GGT:'G',GGC:'G',GGA:'G',GGG:'G'
};
const complementMap = { A:'T', T:'A', G:'C', C:'G' };
const restrictionEnzymes = [
  ['EcoRI','GAATTC'],['BamHI','GGATCC'],['HindIII','AAGCTT'],['XhoI','CTCGAG'],['NotI','GCGGCCGC'],['NheI','GCTAGC'],
  ['SpeI','ACTAGT'],['XbaI','TCTAGA'],['KpnI','GGTACC'],['PstI','CTGCAG'],['SalI','GTCGAC'],['SmaI','CCCGGG']
];
const residueMass = { A:71.0788,R:156.1875,N:114.1038,D:115.0886,C:103.1388,E:129.1155,Q:128.1307,G:57.0519,H:137.1411,I:113.1594,L:113.1594,K:128.1741,M:131.1926,F:147.1766,P:97.1167,S:87.0782,T:101.1051,W:186.2132,Y:163.1760,V:99.1326 };
const aaOrder = 'ACDEFGHIKLMNPQRSTVWY'.split('');

function bodyWithoutFastaHeaders(raw) {
  return raw.split(/\r?\n/).filter(line => !line.trim().startsWith('>')).join('');
}
function cleanDNA(raw) { return bodyWithoutFastaHeaders(raw).toUpperCase().replace(/[^ACGT]/g, ''); }
function reverse(sequence) { return [...sequence].reverse().join(''); }
function complement(sequence) { return [...sequence].map(base => complementMap[base]).join(''); }
function reverseComplement(sequence) { return complement(reverse(sequence)); }
function wrapSequence(sequence, width = 60) { return sequence.match(new RegExp(`.{1,${width}}`, 'g'))?.join('\n') || ''; }
function gcPercent(sequence) { return sequence.length ? ((sequence.match(/[GC]/g) || []).length / sequence.length) * 100 : 0; }
function estimateTm(sequence) {
  if (!sequence.length) return 0;
  const gc = (sequence.match(/[GC]/g) || []).length;
  const at = sequence.length - gc;
  return sequence.length < 14 ? 2 * at + 4 * gc : 64.9 + 41 * (gc - 16.4) / sequence.length;
}
function cleanProtein(raw) { return raw.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, ''); }

function showToast(message) {
  const toast = $('#sequenceToast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function showTool(name, updateUrl = true) {
  const valid = ['dna','translate','primer','digest','protein'].includes(name) ? name : 'dna';
  $$('.tool-nav button').forEach(button => button.classList.toggle('active', button.dataset.tool === valid));
  $$('.tool-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === valid));
  if (updateUrl) history.replaceState(null, '', `#${valid}`);
}
$$('.tool-nav button').forEach(button => button.addEventListener('click', () => showTool(button.dataset.tool)));
showTool(location.hash.slice(1), false);

function updateDNAStats() {
  const raw = $('#dnaInput').value;
  const sequence = cleanDNA(raw);
  $('#dnaLength').textContent = `${sequence.length.toLocaleString()} bp`;
  $('#dnaGc').textContent = `${gcPercent(sequence).toFixed(2)}%`;
  $('#dnaTm').textContent = sequence.length ? `${estimateTm(sequence).toFixed(1)} °C` : '—';
  $('#dnaRemoved').textContent = Math.max(0, raw.length - sequence.length).toLocaleString();
}
$('#dnaInput').addEventListener('input', updateDNAStats);

$$('[data-dna-action]').forEach(button => button.addEventListener('click', () => {
  const sequence = cleanDNA($('#dnaInput').value);
  if (!sequence) return showToast('请先输入有效的 DNA 序列');
  const actions = {
    clean: ['已清洗序列', sequence],
    reverse: ['反向序列', reverse(sequence)],
    complement: ['互补序列', complement(sequence)],
    revcomp: ['反向互补序列', reverseComplement(sequence)],
    fasta: ['FASTA（每行 60 bp）', `>Discovery_sequence_${sequence.length}bp\n${wrapSequence(sequence)}`]
  };
  const [label, result] = actions[button.dataset.dnaAction];
  $('#dnaActionLabel').textContent = label;
  $('#dnaOutput').value = result;
}));

$('#downloadFasta').addEventListener('click', () => {
  const sequence = cleanDNA($('#dnaOutput').value || $('#dnaInput').value);
  if (!sequence) return showToast('没有可下载的 DNA 序列');
  downloadText(`>Discovery_sequence_${sequence.length}bp\n${wrapSequence(sequence)}\n`, 'discovery_sequence.fasta');
});

function translateDNA(raw, frame, stopMode) {
  const cleaned = cleanDNA(raw);
  const template = frame < 0 ? reverseComplement(cleaned) : cleaned;
  const offset = Math.abs(frame) - 1;
  let protein = '', codons = 0, stopCount = 0;
  for (let i = offset; i + 2 < template.length; i += 3) {
    const aa = codonTable[template.slice(i, i + 3)];
    if (!aa) continue;
    codons += 1;
    if (aa === '*') {
      stopCount += 1;
      if (stopMode === 'stop') break;
    }
    protein += aa;
  }
  return { cleaned, protein, codons, stopCount, unused: Math.max(0, (template.length - offset) % 3) };
}

$('#translateButton').addEventListener('click', () => {
  const frame = Number($('#readingFrame').value);
  const result = translateDNA($('#translateInput').value, frame, $('#stopMode').value);
  if (!result.cleaned) return showToast('请先输入有效的 DNA 序列');
  $('#proteinOutput').value = wrapSequence(result.protein);
  const strand = frame > 0 ? '正链' : '反向互补链';
  $('#translationSummary').textContent = `${strand} ${frame > 0 ? '+' : '−'}${Math.abs(frame)} · ${result.codons} 个完整密码子 · ${result.protein.length} aa · ${result.stopCount} 个终止位点 · 末端剩余 ${result.unused} nt`;
});

$('#sendToProtein').addEventListener('click', () => {
  const protein = cleanProtein($('#proteinOutput').value);
  if (!protein) return showToast('请先生成蛋白序列');
  $('#proteinInput').value = protein;
  showTool('protein');
  analyzeProtein();
});

function maxHomopolymer(sequence) {
  let maximum = 0, current = 0, previous = '';
  for (const base of sequence) {
    current = base === previous ? current + 1 : 1;
    previous = base;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

$('#primerButton').addEventListener('click', analyzePrimer);
function analyzePrimer() {
  const sequence = cleanDNA($('#primerInput').value);
  if (!sequence) return showToast('请先输入有效的引物序列');
  const gc = gcPercent(sequence), tm = estimateTm(sequence);
  const clamp = (sequence.slice(-5).match(/[GC]/g) || []).length;
  const homopolymer = maxHomopolymer(sequence);
  $('#primerLength').textContent = `${sequence.length} nt`;
  $('#primerGc').textContent = `${gc.toFixed(1)}%`;
  $('#primerTm').textContent = `${tm.toFixed(1)} °C`;
  $('#primerClamp').textContent = `${clamp} / 5`;
  const advice = [];
  advice.push([sequence.length >= 18 && sequence.length <= 25, `长度 ${sequence.length} nt${sequence.length >= 18 && sequence.length <= 25 ? '，处于常用范围' : '，建议调整至 18–25 nt'}`]);
  advice.push([gc >= 40 && gc <= 60, `GC 含量 ${gc.toFixed(1)}%${gc >= 40 && gc <= 60 ? '，处于推荐范围' : '，建议控制在 40–60%'}`]);
  advice.push([tm >= 55 && tm <= 65, `估算 Tm ${tm.toFixed(1)} °C${tm >= 55 && tm <= 65 ? '，适合常规 PCR 起始设计' : '，建议靠近 55–65 °C'}`]);
  advice.push([clamp >= 1 && clamp <= 3, `3′ 末端 5 nt 含 ${clamp} 个 G/C${clamp >= 1 && clamp <= 3 ? '，GC clamp 合理' : '，通常建议保留 1–3 个'}`]);
  advice.push([homopolymer <= 4, `最长同聚物为 ${homopolymer} nt${homopolymer <= 4 ? '，未见明显连续碱基风险' : '，连续相同碱基可能影响扩增'}`]);
  advice.push([!/[GC]{4}$/.test(sequence), /[GC]{4}$/.test(sequence) ? '3′ 端连续 4 个 G/C，可能增加非特异结合' : '3′ 端未出现连续 4 个 G/C']);
  $('#primerAdvice').innerHTML = advice.map(([pass, text]) => `<li class="${pass ? '' : 'warn'}">${text}</li>`).join('');
}

$('#digestButton').addEventListener('click', () => {
  const sequence = cleanDNA($('#digestInput').value);
  if (!sequence) return showToast('请先输入有效的 DNA 序列');
  let enzymesFound = 0, totalSites = 0;
  $('#digestResults').innerHTML = restrictionEnzymes.map(([name, site]) => {
    const positions = [];
    for (let start = 0; start <= sequence.length - site.length; start++) if (sequence.slice(start, start + site.length) === site) positions.push(start + 1);
    if (positions.length) { enzymesFound += 1; totalSites += positions.length; }
    return `<tr><td>${name}</td><td><code>${site}</code></td><td class="${positions.length ? 'site-hit' : ''}">${positions.length}</td><td>${positions.length ? positions.join(', ') : '—'}</td></tr>`;
  }).join('');
  $('#digestSummary').textContent = `${sequence.length.toLocaleString()} bp 序列 · 检出 ${enzymesFound} 种限制酶 · 共 ${totalSites} 个识别位点（位置为识别序列起始碱基）`;
});

$('#proteinButton').addEventListener('click', analyzeProtein);
function analyzeProtein() {
  const sequence = cleanProtein($('#proteinInput').value);
  if (!sequence) return showToast('请先输入有效的蛋白序列');
  const counts = Object.fromEntries(aaOrder.map(aa => [aa, 0]));
  let mass = 18.015, hydrophobic = 0, aromatic = 0;
  for (const aa of sequence) {
    counts[aa] += 1;
    mass += residueMass[aa];
    if ('AILMFWVY'.includes(aa)) hydrophobic += 1;
    if ('FWY'.includes(aa)) aromatic += 1;
  }
  $('#aaLength').textContent = `${sequence.length.toLocaleString()} aa`;
  $('#aaMass').textContent = mass >= 1000 ? `${(mass / 1000).toFixed(2)} kDa` : `${mass.toFixed(1)} Da`;
  $('#aaHydrophobic').textContent = `${(hydrophobic / sequence.length * 100).toFixed(1)}%`;
  $('#aaAromatic').textContent = `${(aromatic / sequence.length * 100).toFixed(1)}%`;
  $('#aaComposition').innerHTML = aaOrder.map(aa => `<span><b>${aa}</b>${counts[aa]}<small>${(counts[aa] / sequence.length * 100).toFixed(1)}%</small></span>`).join('');
}

$$('[data-copy-target]').forEach(button => button.addEventListener('click', async () => {
  const value = $(`#${button.dataset.copyTarget}`).value;
  if (!value) return showToast('当前没有可复制的结果');
  try { await navigator.clipboard.writeText(value); showToast('结果已复制到剪贴板'); }
  catch { showToast('复制失败，请手动选择结果'); }
}));

function downloadText(content, filename) {
  const url = URL.createObjectURL(new Blob([content], { type:'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
