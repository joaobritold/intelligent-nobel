/**
 * StageTimer Smart Schedule Importer
 * Supports:
 * - PDF files (multi-page or single-page via pdf.js)
 * - Excel / CSV / TXT files (via SheetJS / text parser)
 * - Copy-pasted schedule text from Excel, Word, PDF, or WhatsApp
 * Automatically extracts Artist Name, On-Stage Start/End Time, Duration, and Notes!
 */

class ScheduleImporter {
  static parseTimeStrToMinutes(str) {
    if (!str) return null;
    // Match 23h00, 23:00, 2h30, 01:45, 5h00
    const m = str.trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{2})?$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    return h * 60 + min;
  }

  static formatCleanTime(str) {
    const m = str.trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{2})?$/);
    if (!m) return str.trim();
    const h = String(parseInt(m[1], 10)).padStart(2, '0');
    const min = m[2] ? String(parseInt(m[2], 10)).padStart(2, '0') : '00';
    return `${h}:${min}`;
  }

  /**
   * Parse lines of text or rows into StageTimer artist objects
   */
  static parseTextToTimers(rawText) {
    if (!rawText) return [];
    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const results = [];
    // Regex that finds time ranges like "23h00 - 00h15", "01:45 – 03h15", "01h30 - 2h30"
    const rangeRegex = /(\d{1,2}\s*[:hH]\s*\d{0,2})\s*[-–—a]\s*(\d{1,2}\s*[:hH]\s*\d{0,2})/g;

    const ignoreHeaders = /^(artista|load\s*in|set\s*up|soundcheck|changeover|on\s*stage|curfew|a\s*impossibilidade|contactos|paulo\s*ferr|rece[cç][aã]o|caloiro)/i;

    for (const line of lines) {
      if (ignoreHeaders.test(line) && !/\d{1,2}\s*[:hH]\s*\d{2}\s*[-–—]\s*\d{1,2}/.test(line)) {
        continue;
      }

      const matches = [...line.matchAll(rangeRegex)];
      if (matches.length === 0) continue;

      // In tables like Receção ao Caloiro:
      // Columns are: Artista | Load in | Set Up (range) | Changeover (range) | On Stage (range) | Curfew
      // So the LAST time range on the line is always "On Stage"!
      const onStageMatch = matches[matches.length - 1];
      const startRaw = onStageMatch[1];
      const endRaw = onStageMatch[2];

      const startMins = this.parseTimeStrToMinutes(startRaw);
      const endMins = this.parseTimeStrToMinutes(endRaw);
      if (startMins === null || endMins === null) continue;

      let diffMins = endMins - startMins;
      if (diffMins <= 0) {
        diffMins += 24 * 60; // Crosses midnight (e.g. 23:00 -> 00:15 = 75 mins)
      }
      // Sanity bound (between 5 min and 10 hours)
      if (diffMins < 5 || diffMins > 600) diffMins = 60;

      // Extract Artist Name: text before the first time or dash column
      const firstTimeIdx = line.search(/(\d{1,2}\s*[:hH]\s*\d{0,2}|\s-\s)/);
      let artistName = firstTimeIdx > 0 ? line.substring(0, firstTimeIdx).trim() : line;
      artistName = artistName.replace(/^[-–—•|\s]+|[-–—•|\s]+$/g, '').trim();

      if (!artistName || /^(artista|on\s*stage)$/i.test(artistName)) continue;

      const cleanStart = this.formatCleanTime(startRaw);
      const cleanEnd = this.formatCleanTime(endRaw);
      const slotStr = `${cleanStart} – ${cleanEnd}`;

      // Build extra notes (Changeover / Curfew if present)
      const notesParts = [`On Stage: ${slotStr}`];
      if (matches.length >= 2) {
        const prevRange = matches[matches.length - 2];
        notesParts.push(`Check: ${this.formatCleanTime(prevRange[1])}-${this.formatCleanTime(prevRange[2])}`);
      }
      const afterOnStage = line.substring(onStageMatch.index + onStageMatch[0].length).trim();
      const curfewMatch = afterOnStage.match(/(\d{1,2}\s*[:hH]\s*\d{0,2})/);
      if (curfewMatch) {
        notesParts.push(`Curfew: ${this.formatCleanTime(curfewMatch[1])}`);
      }

      const durationMs = diffMins * 60000;

      results.push({
        id: 'imp_' + Math.random().toString(36).substring(2, 9),
        name: artistName,
        startTime: slotStr,
        notes: notesParts.join(' • '),
        mode: 'countdown',
        duration: durationMs,
        elapsed: 0,
        state: 'stopped',
        warnAt: Math.min(600000, Math.floor(durationMs * 0.2)),
        dangerAt: Math.min(120000, Math.floor(durationMs * 0.05)),
        startedAt: null
      });
    }

    return results;
  }

  /**
   * Extract text from PDF file (returns array of pages text)
   */
  static async extractPdfPages(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Biblioteca PDF.js ainda a carregar. Tente novamente em 2 segundos.');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group items by Y coordinate (rows in the table)
      const rowMap = new Map();
      for (const item of textContent.items) {
        const str = item.str;
        if (!str || !str.trim()) continue;
        const y = Math.round(item.transform[5] / 6) * 6; // Group items within ~6px height
        const x = item.transform[4];
        if (!rowMap.has(y)) rowMap.set(y, []);
        rowMap.get(y).push({ x, str });
      }

      // Sort rows top-to-bottom (descending Y in PDF coords) and items left-to-right
      const sortedYs = [...rowMap.keys()].sort((a, b) => b - a);
      const lines = sortedYs.map(y => {
        const items = rowMap.get(y).sort((a, b) => a.x - b.x);
        return items.map(i => i.str).join(' ');
      });

      pages.push(lines.join('\n'));
    }

    return pages;
  }

  /**
   * Extract text from Excel / CSV / TXT file
   */
  static async extractSpreadsheetOrText(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (['xlsx', 'xls', 'csv'].includes(ext) && typeof XLSX !== 'undefined') {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const pages = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
        const text = rows.map(r => (r || []).join(' ')).join('\n');
        pages.push(text);
      }
      return pages;
    }

    // Fallback plain text
    const txt = await file.text();
    return [txt];
  }
}

window.ScheduleImporter = ScheduleImporter;
