/**
 * TheatreImporter — Universal File & Text Importer for Theatre Mode
 * Supports PDF, Excel (.xlsx, .xls, .csv), Word (.docx), and plain text for both Scripts and Cues.
 */
class TheatreImporter {
  static VALID_DEPTS = ['Luz', 'Som', 'Maquinaria', 'Vídeo', 'Coxias'];

  static normalizeDepartments(deptRaw) {
    if (!deptRaw) return ['Luz'];
    if (Array.isArray(deptRaw)) return deptRaw;
    const str = String(deptRaw).toLowerCase();
    const matched = [];
    if (str.includes('luz') || str.includes('light') || str.includes('ilum')) matched.push('Luz');
    if (str.includes('som') || str.includes('sound') || str.includes('audio') || str.includes('áudio')) matched.push('Som');
    if (str.includes('maq') || str.includes('mach') || str.includes('cenar') || str.includes('cenár') || str.includes('vara') || str.includes('cortina')) matched.push('Maquinaria');
    if (str.includes('vid') || str.includes('proj') || str.includes('ecra') || str.includes('ecrã') || str.includes('tela')) matched.push('Vídeo');
    if (str.includes('cox') || str.includes('ader') || str.includes('ator') || str.includes('palco')) matched.push('Coxias');
    if (str.includes('tod') || str.includes('geral') || str.includes('all')) return [...TheatreImporter.VALID_DEPTS];
    return matched.length > 0 ? matched : ['Luz'];
  }

  /**
   * Extract raw text from file (PDF, Word, Excel, or Text)
   */
  static async extractTextFromFile(file) {
    if (!file) throw new Error('Nenhum ficheiro fornecido.');
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    // 1. PDF
    if (ext === 'pdf') {
      return await TheatreImporter._extractFromPdf(file);
    }

    // 2. Word (.docx)
    if (ext === 'docx') {
      return await TheatreImporter._extractFromDocx(file);
    }

    // 3. Excel (.xlsx, .xls, .csv)
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      return await TheatreImporter._extractFromSpreadsheet(file);
    }

    // 4. Plain Text (.txt, .rtf, or other text)
    return await TheatreImporter._extractFromPlainText(file);
  }

  static async _extractFromPdf(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Biblioteca PDF.js não está carregada.');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allLines = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = [];

      for (const item of textContent.items) {
        const str = (item.str || '').trim();
        if (!str) continue;
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || 0
        });
      }

      if (items.length === 0) continue;

      // Sort by Y descending (top-to-bottom), then X ascending (left-to-right)
      items.sort((a, b) => b.y - a.y || a.x - b.x);

      // Cluster into rows
      const rows = [];
      for (const it of items) {
        let placed = false;
        for (const r of rows) {
          if (Math.abs(it.y - r.y) <= 5.0) {
            r.items.push(it);
            r.y = (r.y * (r.items.length - 1) + it.y) / r.items.length;
            placed = true;
            break;
          }
        }
        if (!placed) {
          rows.push({ y: it.y, items: [it] });
        }
      }

      // Reconstruct lines with column preservation
      rows.forEach(r => {
        r.items.sort((a, b) => a.x - b.x);
        let line = '';
        let lastRight = null;
        for (const it of r.items) {
          if (lastRight !== null) {
            const gap = it.x - lastRight;
            if (gap > 18) line += '\t';
            else if (gap > 2) line += ' ';
          }
          line += it.str;
          lastRight = it.x + it.width;
        }
        if (line.trim()) allLines.push(line.trim());
      });
    }

    return allLines.join('\n');
  }

  static async _extractFromDocx(file) {
    if (typeof mammoth !== 'undefined' && mammoth.extractRawText) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return (result.value || '').trim();
      } catch (err) {
        console.warn('Mammoth parsing failed, fallback to plain text reader', err);
      }
    }
    return await TheatreImporter._extractFromPlainText(file);
  }

  static async _extractFromSpreadsheet(file) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Biblioteca XLSX não está carregada.');
    }
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const lines = [];

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      rows.forEach(r => {
        if (!Array.isArray(r)) return;
        const line = r.map(c => String(c).trim()).filter(Boolean).join('\t');
        if (line) lines.push(line);
      });
    });

    return lines.join('\n');
  }

  static _extractFromPlainText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result || '');
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  /**
   * Parse text into structured Script items (Dialogue, Direction, Heading)
   */
  static parseScriptText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const script = [];

    lines.forEach((line, idx) => {
      // 1. Heading (ACTO, CENA, QUADRO, PRÓLOGO, EPÍLOGO)
      if (/^(acto|ato|cena|quadro|pr[oó]logo|ep[ií]logo|parte)\b/i.test(line)) {
        script.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'heading',
          speaker: '',
          text: line,
          cueAnchor: null
        });
        return;
      }

      // 2. Stage Direction ([rubrica...] ou (didascália...))
      if ((line.startsWith('[') && line.endsWith(']')) || (line.startsWith('(') && line.endsWith(')'))) {
        script.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'direction',
          speaker: '',
          text: line.replace(/^[\[\(]/, '').replace(/[\]\)]$/, '').trim(),
          cueAnchor: null
        });
        return;
      }

      // 3. Dialogue (SPEAKER: speech)
      const colonMatch = line.match(/^([A-ZÀ-Ú0-9\s]{2,25}):\s*(.+)$/i);
      if (colonMatch) {
        script.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'dialogue',
          speaker: colonMatch[1].trim().toUpperCase(),
          text: colonMatch[2].trim(),
          cueAnchor: null
        });
      } else {
        script.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'dialogue',
          speaker: '',
          text: line,
          cueAnchor: null
        });
      }
    });

    return script;
  }

  /**
   * Parse Cues from File (handles Excel column headers or structured text)
   */
  static async parseCuesFromFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    // If Excel / CSV, parse table columns directly
    if (['xlsx', 'xls', 'csv'].includes(ext) && typeof XLSX !== 'undefined') {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (firstSheet) {
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
        if (rows && rows.length > 0) {
          const cues = TheatreImporter._parseCuesFromTableRows(rows);
          if (cues.length > 0) return cues;
        }
      }
    }

    // Otherwise extract text and parse line-by-line
    const text = await TheatreImporter.extractTextFromFile(file);
    return TheatreImporter.parseCuesFromText(text);
  }

  static _parseCuesFromTableRows(rows) {
    if (!rows || rows.length < 2) return [];

    // Find header indices
    const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
    const idxNum = headers.findIndex(h => /^(q|cue|num|n[oº]|deixa|n[uú]mero)$/i.test(h));
    const idxName = headers.findIndex(h => /^(nome|name|a[cç][aã]o|t[ií]tulo|title|descri[cç][aã]o)$/i.test(h));
    const idxDept = headers.findIndex(h => /^(dept|depts|departamento|departamentos|equipa|equipas|setor)$/i.test(h));
    const idxTarget = headers.findIndex(h => /^(gatilho|fala|ponto|target|momento|trigger)$/i.test(h));
    const idxNotes = headers.findIndex(h => /^(nota|notas|obs|observa[cç][oõ]es|notes|tempo)$/i.test(h));

    // If no clear headers, fallback to positional parsing
    const hasHeaders = idxNum !== -1 || idxName !== -1;
    const startRow = hasHeaders ? 1 : 0;
    const cues = [];

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row) || row.every(c => !String(c).trim())) continue;

      let num = hasHeaders && idxNum !== -1 ? String(row[idxNum] || '').trim() : String(row[0] || '').trim();
      let name = hasHeaders && idxName !== -1 ? String(row[idxName] || '').trim() : String(row[1] || '').trim();
      let dept = hasHeaders && idxDept !== -1 ? row[idxDept] : row[2];
      let target = hasHeaders && idxTarget !== -1 ? String(row[idxTarget] || '').trim() : String(row[3] || '').trim();
      let notes = hasHeaders && idxNotes !== -1 ? String(row[idxNotes] || '').trim() : String(row[4] || '').trim();

      if (!num && !name) continue;
      if (!num) num = `Q${cues.length + 1}`;
      if (!/^q/i.test(num) && /^\d+$/.test(num)) num = `Q${num}`;

      cues.push({
        id: 'cue_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 3),
        num: num,
        name: name || `Deixa ${num}`,
        departments: TheatreImporter.normalizeDepartments(dept),
        targetText: target,
        notes: notes,
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      });
    }

    return cues;
  }

  /**
   * Parse Cues from plain text / pasted string
   * Supports:
   * 1. Q1 | Abertura de Sala | Luz, Som | Fala de gatilho | Notas
   * 2. Q1\tAbertura\tLuz\tGatilho\tNotas
   * 3. Q1: Abertura [Luz, Som] - Fala de gatilho (Notas)
   */
  static parseCuesFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const cues = [];

    lines.forEach((line, idx) => {
      // Ignore comment or header lines
      if (/^(deixa|cue|num)\s*(\||;|\t)/i.test(line)) return;

      let num = '';
      let name = '';
      let deptRaw = '';
      let target = '';
      let notes = '';

      // Format 1: Tab-separated or Pipe/Semicolon separated
      if (line.includes('\t') || line.includes('|') || line.includes(';')) {
        const parts = line.split(/[\t|;]/).map(p => p.trim());
        num = parts[0] || `Q${idx + 1}`;
        name = parts[1] || `Deixa ${num}`;
        deptRaw = parts[2] || 'Luz';
        target = parts[3] || '';
        notes = parts[4] || '';
      } else {
        // Format 2: Regex Q1: Nome [Luz, Som] - Gatilho
        const match = line.match(/^(Q\d+|\d+)\s*[:\-–]\s*([^\[\(\-]+)(?:\[(.*?)\])?(?:\s*[-–]\s*([^\(\)]+))?(?:\s*\((.*?)\))?$/i);
        if (match) {
          num = match[1];
          name = match[2].trim();
          deptRaw = match[3] || 'Luz';
          target = match[4] ? match[4].trim() : '';
          notes = match[5] ? match[5].trim() : '';
        } else {
          // Fallback line
          num = `Q${idx + 1}`;
          name = line;
          deptRaw = 'Luz';
        }
      }

      if (!/^q/i.test(num) && /^\d+$/.test(num)) num = `Q${num}`;

      cues.push({
        id: 'cue_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 3),
        num: num,
        name: name,
        departments: TheatreImporter.normalizeDepartments(deptRaw),
        targetText: target,
        notes: notes,
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      });
    });

    return cues;
  }
}

if (typeof window !== 'undefined') {
  window.TheatreImporter = TheatreImporter;
}
