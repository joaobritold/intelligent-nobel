/**
 * StageTimer Smart Schedule Importer
 * Extracts Soundcheck, Changeover/Line Check, and On Stage slots as separate timers,
 * leaves Notes clean (empty), and ignores Curfew!
 */

class ScheduleImporter {
  static parseTimeStrToMinutes(str) {
    if (!str) return null;
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

  static calcDurationMs(startRaw, endRaw) {
    const s = this.parseTimeStrToMinutes(startRaw);
    const e = this.parseTimeStrToMinutes(endRaw);
    if (s === null || e === null) return 3600000;
    let diff = e - s;
    if (diff <= 0) diff += 24 * 60;
    if (diff < 5 || diff > 600) diff = 60;
    return diff * 60000;
  }

  static makeTimerObj(name, startRaw, endRaw) {
    const cleanStart = this.formatCleanTime(startRaw);
    const cleanEnd = this.formatCleanTime(endRaw);
    const durationMs = this.calcDurationMs(startRaw, endRaw);
    return {
      id: 'imp_' + Math.random().toString(36).substring(2, 9),
      name,
      startTime: `${cleanStart} – ${cleanEnd}`,
      notes: '', // Clean empty notes as requested!
      mode: 'countdown',
      duration: durationMs,
      elapsed: 0,
      state: 'stopped',
      warnAt: Math.min(600000, Math.floor(durationMs * 0.2)),
      dangerAt: Math.min(120000, Math.floor(durationMs * 0.05)),
      startedAt: null
    };
  }

  /**
   * Parse lines of text into Soundchecks, Changeovers, and On Stage timers
   */
  static parseTextToTimers(rawText) {
    if (!rawText) return [];
    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const soundchecks = [];
    const mainActs = [];

    const rangeRegex = /(\d{1,2}\s*[:hH]\s*\d{0,2})\s*[-–—a]\s*(\d{1,2}\s*[:hH]\s*\d{0,2})/g;
    const ignoreHeaders = /^(artista|load\s*in|set\s*up|soundcheck|changeover|on\s*stage|curfew|a\s*impossibilidade|contactos|paulo\s*ferr|rece[cç][aã]o|caloiro)/i;

    for (const line of lines) {
      if (ignoreHeaders.test(line) && !/\d{1,2}\s*[:hH]\s*\d{2}\s*[-–—]\s*\d{1,2}/.test(line)) {
        continue;
      }

      const matches = [...line.matchAll(rangeRegex)];
      if (matches.length === 0) continue;

      const firstTimeIdx = line.search(/(\d{1,2}\s*[:hH]\s*\d{0,2}|\s-\s)/);
      let artistName = firstTimeIdx > 0 ? line.substring(0, firstTimeIdx).trim() : line;
      artistName = artistName.replace(/^[-–—•|\s]+|[-–—•|\s]+$/g, '').trim();
      if (!artistName || /^(artista|on\s*stage)$/i.test(artistName)) continue;

      if (matches.length === 1) {
        // Only On Stage range
        mainActs.push(this.makeTimerObj(artistName, matches[0][1], matches[0][2]));
      } else if (matches.length === 2) {
        // Soundcheck/Setup + On Stage (or Changeover + On Stage)
        const firstStart = this.parseTimeStrToMinutes(matches[0][1]);
        if (firstStart !== null && firstStart >= 12 * 60 && firstStart < 22 * 60) {
          soundchecks.push(this.makeTimerObj(`${artistName} (Soundcheck)`, matches[0][1], matches[0][2]));
        } else {
          mainActs.push(this.makeTimerObj(`${artistName} (Changeover)`, matches[0][1], matches[0][2]));
        }
        mainActs.push(this.makeTimerObj(artistName, matches[1][1], matches[1][2]));
      } else if (matches.length >= 3) {
        // Soundcheck + Changeover + On Stage
        soundchecks.push(this.makeTimerObj(`${artistName} (Soundcheck)`, matches[0][1], matches[0][2]));
        mainActs.push(this.makeTimerObj(`${artistName} (Changeover)`, matches[1][1], matches[1][2]));
        const last = matches[matches.length - 1];
        mainActs.push(this.makeTimerObj(artistName, last[1], last[2]));
      }
    }

    return [...soundchecks, ...mainActs];
  }

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

      const rowMap = new Map();
      for (const item of textContent.items) {
        const str = item.str;
        if (!str || !str.trim()) continue;
        const y = Math.round(item.transform[5] / 6) * 6;
        const x = item.transform[4];
        if (!rowMap.has(y)) rowMap.set(y, []);
        rowMap.get(y).push({ x, str });
      }

      const sortedYs = [...rowMap.keys()].sort((a, b) => b - a);
      const lines = sortedYs.map(y => {
        const items = rowMap.get(y).sort((a, b) => a.x - b.x);
        return items.map(i => i.str).join(' ');
      });

      pages.push(lines.join('\n'));
    }

    return pages;
  }

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
    const txt = await file.text();
    return [txt];
  }
}

window.ScheduleImporter = ScheduleImporter;
