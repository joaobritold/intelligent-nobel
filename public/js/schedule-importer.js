/**
 * StageTimer Smart Schedule Importer (v2)
 * Advanced timetable & schedule parser for PDF, Excel (.xlsx, .xls, .csv), and pasted text.
 *
 * Capabilities:
 * - Multi-day detection:
 *   - Explicit "Dia X", "Day X", "Xº Dia", "1ª Noite"
 *   - Days of the week in Portuguese & English (Segunda, Terça, ..., Sunday)
 *   - Standalone dates (24/10, 24 de Outubro, 24-10-2026)
 *   - Multi-page PDFs (each page can be a day, skipping non-timetable pages)
 *   - Multi-sheet Excel workbooks (sheet names as days, or rows grouped by "Dia" column)
 * - Flexible time format support:
 *   - Colons: 23:00, 00:15
 *   - Dots: 23.00, 00.15 (very common in European / Portuguese festival sheets)
 *   - H-notation: 23h00, 23h, 4h30, 0h
 *   - Excel time fractions: 0.95833
 * - Flexible range separators:
 *   - Hyphens / dashes: "-", "–" (en-dash), "—" (em-dash), "~"
 *   - Portuguese words: "às", "as", "até", "ate", "a"
 *   - English words: "to", "till", "until"
 *   - Arrows: "->", "-->", ">"
 *   - Slashes: "/", "\"
 *   - Tab or multi-space separation between columns in tables
 * - Single start-time timetables:
 *   - When lines only specify start times (e.g. "23:00 DJ Residente"), calculates sequential durations automatically
 * - Smart artist name extraction:
 *   - Cleans matched times and delimiters regardless of whether time is before or after the artist name
 *   - Preserves internal artist hyphens (e.g. "Pedro Abrunhosa - Trio")
 *   - Ignores Curfew / Load-in times and column headers
 * - Options:
 *   - includeSoundchecks: boolean (default false -> imports only the main On Stage performance; true -> creates Soundcheck/Changeover timers)
 * - PDF Dynamic Row Clustering:
 *   - Groups text items by baseline proximity (Math.abs(y - row.y) <= 5.5) instead of fixed division buckets
 *   - Reconstructs columns using tab separation
 */

class ScheduleImporter {
  /**
   * Parse any time string into integer minutes from midnight (0..1439)
   */
  static parseTimeStrToMinutes(str) {
    if (str === null || str === undefined) return null;
    str = String(str).trim();
    if (!str) return null;

    // Excel decimal day fraction (e.g. 0.958333 -> 23:00)
    if (/^0\.\d+$/.test(str)) {
      const frac = parseFloat(str);
      if (frac >= 0 && frac < 1) {
        return Math.round(frac * 24 * 60) % 1440;
      }
    }

    // Match "23:00", "23.00", "23h00", "23h15", "4h30", "01:30"
    const m = str.match(/^(\d{1,2})\s*[:.hH]\s*(\d{1,2})?$/) || str.match(/^(\d{1,2})\s*[hH]$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h === 24) h = 0; // midnight
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  /**
   * Format any time string into standardized "HH:MM"
   */
  static formatCleanTime(str) {
    const mins = this.parseTimeStrToMinutes(str);
    if (mins === null) {
      return String(str || '').trim();
    }
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  /**
   * Calculate duration in ms between start and end times, supporting midnight rollover
   */
  static calcDurationMs(startRaw, endRaw, fallbackMins = 60) {
    const s = this.parseTimeStrToMinutes(startRaw);
    const e = this.parseTimeStrToMinutes(endRaw);
    if (s === null || e === null) return fallbackMins * 60000;
    let diff = e - s;
    if (diff <= 0) diff += 24 * 60; // Midnight rollover (e.g. 23:00 -> 00:15 = 75m)
    if (diff < 5 || diff > 720) diff = fallbackMins; // Sanity check (5m to 12h)
    return diff * 60000;
  }

  /**
   * Create a standardized StageTimer timer object
   */
  static makeTimerObj(name, startRaw, endRaw, customDurationMs = null) {
    const cleanStart = this.formatCleanTime(startRaw);
    const cleanEnd = this.formatCleanTime(endRaw);
    const duration = customDurationMs || this.calcDurationMs(startRaw, endRaw);
    const cleanName = String(name || 'Artista').trim().replace(/\s+/g, ' ');

    return {
      id: 'imp_' + Math.random().toString(36).substring(2, 9),
      name: cleanName,
      startTime: `${cleanStart} – ${cleanEnd}`,
      notes: '', // Clean empty notes as requested!
      mode: 'countdown',
      duration,
      elapsed: 0,
      state: 'stopped',
      warnAt: Math.min(600000, Math.floor(duration * 0.2)),
      dangerAt: Math.min(120000, Math.floor(duration * 0.05)),
      startedAt: null
    };
  }

  /**
   * Regex matching individual time tokens: 23:00, 23.00, 23h00, 23h, 4h30, 0h
   */
  static _getTimeTokenRegex() {
    return /\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b/gi;
  }

  /**
   * Regex matching time ranges with any separator:
   * "-", "–", "—", "~", "às", "as", "até", "ate", "a", "to", "till", "until", "->", ">", "/", "|", tabs, spaces
   */
  static _getTimeRangeRegex() {
    return /(\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b)\s*(?:[-–—~]|às|as|até|ate|\ba\b|\bto\b|\btill\b|\buntil\b|-->?|>|=>|\/|\\|\||\t|\s{2,})\s*(\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b)/gi;
  }

  /**
   * Check if a line is purely a table header or production metadata (not an artist row)
   */
  static _isHeaderOrMetaLine(line) {
    const l = (line || '').trim().toLowerCase();
    if (!l) return true;

    // Header column names without concrete artist times
    if (/^(artista|hor[áa]rio|palco|stage|lineup|line-up|programação|programa|data|dia|day|load\s*in|set\s*up|soundcheck|changeover|on\s*stage|curfew|obs|observa[çc][õo]es|contacto[s]?|rider|catering)\b/i.test(l) &&
        !/\d{1,2}\s*[:.hH]/.test(l)) {
      return true;
    }
    // Production notices
    if (/^(a\s*impossibilidade|regras|normas|contacto[s]?\s*de\s*produção|respons[áa]vel|ficheiro|página)/i.test(l)) {
      return true;
    }
    return false;
  }

  /**
   * Extract a clean artist name from a line by removing matched time ranges and table punctuation
   */
  static _cleanArtistName(rawLine, timeMatches = []) {
    let clean = rawLine;

    // Remove curfew expressions
    clean = clean.replace(/\bcurfew\s*[:=-]?\s*\d{1,2}(?:[:.hH]\d{2}|[hH])\b/gi, ' ');
    clean = clean.replace(/\bcurfew\b/gi, ' ');

    // Remove all matched time ranges
    for (const m of timeMatches) {
      if (m && m[0]) {
        clean = clean.replace(m[0], ' ');
      }
    }

    // Remove any remaining standalone time tokens (e.g. curfew or load-in times)
    clean = clean.replace(/\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b/gi, ' ');

    // Remove common column header words if left behind
    clean = clean.replace(/\b(?:artista|load\s*in|soundcheck|set\s*up|changeover|line\s*check|on\s*stage|palco|stage|live|hora|hor[áa]rio)\b/gi, ' ');

    // Remove table borders, tabs, bullet characters, leading/trailing punctuation
    clean = clean.replace(/[|•\t;~_]+/g, ' ');
    clean = clean.replace(/\s+/g, ' ');
    clean = clean.replace(/^[\s\-–—:=/]+|[\s\-–—:=/]+$/g, '').trim();

    return clean;
  }

  /**
   * Fallback parser for timetables that only list single start times per row:
   * e.g.:
   * 23:00 DJ Residente
   * 00:15 Batalha de Berço
   * 01:30 Tay
   * 03:00 DJ Beça
   * 04:30 Fim / Curfew
   */
  static _parseSingleStartTimeLines(lines) {
    const timeTokenRegex = /\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b/i;
    const entries = [];
    let curfewMinutes = null;
    let curfewStr = null;

    for (const line of lines) {
      if (this._isHeaderOrMetaLine(line)) continue;

      const m = line.match(timeTokenRegex);
      if (!m) continue;

      const timeStr = m[0];
      const mins = this.parseTimeStrToMinutes(timeStr);
      if (mins === null) continue;

      let name = line.replace(timeStr, ' ');
      name = name.replace(/[|•\t;~_]+/g, ' ');
      name = name.replace(/\s+/g, ' ');
      name = name.replace(/^[\s\-–—:=/]+|[\s\-–—:=/]+$/g, '').trim();

      if (!name) continue;

      // Check if this row denotes Curfew or End of Show
      if (/^(curfew|fim|encerramento|fecho|close|end)$/i.test(name)) {
        curfewMinutes = mins;
        curfewStr = timeStr;
        continue;
      }

      entries.push({
        name,
        startStr: timeStr,
        startMinutes: mins
      });
    }

    if (entries.length === 0) return [];

    const timers = [];
    for (let i = 0; i < entries.length; i++) {
      const cur = entries[i];
      const next = entries[i + 1];
      let endStr = null;
      let durationMs = null;

      if (next) {
        endStr = next.startStr;
        durationMs = this.calcDurationMs(cur.startStr, next.startStr);
      } else if (curfewStr && curfewMinutes !== null) {
        endStr = curfewStr;
        durationMs = this.calcDurationMs(cur.startStr, curfewStr);
      } else {
        // Last artist of the night: default to 60 or 90 minutes
        const endMins = (cur.startMinutes + 60) % 1440;
        const h = String(Math.floor(endMins / 60)).padStart(2, '0');
        const m = String(endMins % 60).padStart(2, '0');
        endStr = `${h}:${m}`;
        durationMs = 3600000;
      }

      timers.push(this.makeTimerObj(cur.name, cur.startStr, endStr, durationMs));
    }

    return timers;
  }

  /**
   * Parse a block of text into timer objects.
   * Options:
   * - includeSoundchecks: boolean (default false -> extracts only On Stage performance)
   */
  static parseTextToTimers(rawText, options = {}) {
    const includeSoundchecks = !!options.includeSoundchecks;
    if (!rawText) return [];

    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.replace(/\u00A0/g, ' ').trim())
      .filter(Boolean);

    const soundchecks = [];
    const mainActs = [];
    const rangeRegex = this._getTimeRangeRegex();

    for (const line of lines) {
      if (this._isHeaderOrMetaLine(line)) continue;

      const matches = [...line.matchAll(rangeRegex)];
      if (matches.length > 0) {
        const artistName = this._cleanArtistName(line, matches);
        if (!artistName || artistName.length < 2) continue;

        if (includeSoundchecks) {
          if (matches.length === 1) {
            mainActs.push(this.makeTimerObj(artistName, matches[0][1], matches[0][2]));
          } else if (matches.length === 2) {
            const firstStart = this.parseTimeStrToMinutes(matches[0][1]);
            if (firstStart !== null && firstStart >= 12 * 60 && firstStart < 22 * 60) {
              soundchecks.push(this.makeTimerObj(`${artistName} (Soundcheck)`, matches[0][1], matches[0][2]));
            } else {
              mainActs.push(this.makeTimerObj(`${artistName} (Changeover)`, matches[0][1], matches[0][2]));
            }
            mainActs.push(this.makeTimerObj(artistName, matches[1][1], matches[1][2]));
          } else if (matches.length >= 3) {
            soundchecks.push(this.makeTimerObj(`${artistName} (Soundcheck)`, matches[0][1], matches[0][2]));
            mainActs.push(this.makeTimerObj(`${artistName} (Changeover)`, matches[1][1], matches[1][2]));
            const last = matches[matches.length - 1];
            mainActs.push(this.makeTimerObj(artistName, last[1], last[2]));
          }
        } else {
          // Default: Only the main performance (last range before curfew in production tables)
          const lastRange = matches[matches.length - 1];
          mainActs.push(this.makeTimerObj(artistName, lastRange[1], lastRange[2]));
        }
      }
    }

    if (mainActs.length === 0 && soundchecks.length === 0) {
      // Fallback: Check if schedule uses single start times per row
      return this._parseSingleStartTimeLines(lines);
    }

    return [...soundchecks, ...mainActs];
  }

  /**
   * Helper to detect if a line is a Day Header (Dia 1, Sexta, 24/10, etc.)
   */
  static _detectDayHeader(line) {
    if (!line) return null;
    const l = line.trim();

    // 1. Explicit "Dia X" or "Day X"
    const mDia = l.match(/\b(?:dia|day)\s*0?(\d{1,2})\b/i);
    if (mDia) {
      const num = parseInt(mDia[1], 10);
      return { dayNumber: num, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, '') };
    }

    // 2. Ordinal Day ("1º Dia", "2º Dia", "1ª Noite")
    const mOrd = l.match(/\b(\d{1,2})\s*[ºªo\.]*\s*(?:dia|noite)\b/i);
    if (mOrd) {
      const num = parseInt(mOrd[1], 10);
      return { dayNumber: num, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, '') };
    }

    // 3. Days of the week in Portuguese / English
    const mWeek = l.match(/\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:-feira|\s*feira)?\b/i);
    if (mWeek) {
      return { dayNumber: null, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, ''), isWeekDay: true };
    }

    // 4. Standalone Date (e.g. "24 de Outubro" or "24/10" or "24/10/2026")
    const mDate = l.match(/\b(\d{1,2})\s*(?:de\s+)?(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/i) ||
                  l.match(/^\s*(?:===+\s*)?(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-]\d{2,4})?\b/i);
    if (mDate) {
      return { dayNumber: null, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, ''), isDate: true };
    }

    return null;
  }

  /**
   * Split a single block of text by day section headers
   */
  static _splitTextByDayHeaders(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const rangeRegex = this._getTimeRangeRegex();

    const sections = [];
    let currentTitle = 'Dia 1';
    let currentDayNum = 1;
    let currentLines = [];
    let detectedCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        currentLines.push(line);
        continue;
      }

      // Check if line is a day header (and NOT a full artist row with time range)
      const hasTimeRange = rangeRegex.test(trimmed);
      rangeRegex.lastIndex = 0; // reset state

      if (!hasTimeRange) {
        const headerInfo = this._detectDayHeader(trimmed);
        if (headerInfo) {
          if (currentLines.filter(l => l.trim()).length > 0) {
            sections.push({
              title: currentTitle,
              dayNumber: currentDayNum,
              text: currentLines.join('\n')
            });
            currentLines = [];
          }
          detectedCount++;
          currentDayNum = headerInfo.dayNumber !== null ? headerInfo.dayNumber : detectedCount;
          currentTitle = headerInfo.title || `Dia ${currentDayNum}`;
          continue;
        }
      }

      currentLines.push(line);
    }

    if (currentLines.filter(l => l.trim()).length > 0) {
      sections.push({
        title: currentTitle,
        dayNumber: currentDayNum,
        text: currentLines.join('\n')
      });
    }

    if (detectedCount >= 1 && sections.length > 1) {
      return sections;
    }
    return [{ title: 'Dia 1', dayNumber: 1, text }];
  }

  /**
   * Universal multi-day schedule parser.
   * Handles multi-page PDFs, multi-sheet spreadsheets, or multi-day pasted text.
   * Options:
   * - includeSoundchecks: boolean
   */
  static parseMultiDaySchedule(input, options = {}) {
    let pages = [];
    let pageSheetTitles = [];

    if (Array.isArray(input)) {
      pages = input;
    } else if (typeof input === 'string') {
      pages = [input];
    } else if (input && typeof input === 'object' && Array.isArray(input.pages)) {
      pages = input.pages;
      pageSheetTitles = input.titles || [];
    } else {
      return { isMultiDay: false, totalDays: 0, totalTimers: 0, days: {}, dayTitles: {} };
    }

    const daysMap = {};
    const titlesMap = {};
    let dayIndex = 1;

    for (let p = 0; p < pages.length; p++) {
      const pageText = pages[p] || '';
      if (!pageText.trim()) continue;

      const assignedTitle = pageSheetTitles[p];
      const pageSections = this._splitTextByDayHeaders(pageText);

      if (pageSections.length > 1) {
        // Multi-day sections found within this page/sheet
        for (const s of pageSections) {
          const parsed = this.parseTextToTimers(s.text, options);
          if (parsed.length > 0) {
            const dNum = s.dayNumber || dayIndex;
            const finalDay = daysMap[String(dNum)] ? dayIndex : dNum;
            daysMap[String(finalDay)] = parsed;
            titlesMap[String(finalDay)] = s.title || `Dia ${finalDay}`;
            dayIndex = Math.max(dayIndex, finalDay) + 1;
          }
        }
      } else {
        // Single section for this page/sheet
        const parsed = this.parseTextToTimers(pageText, options);
        if (parsed.length > 0) {
          let detectedDay = null;
          let detectedTitle = null;

          if (assignedTitle) {
            const h = this._detectDayHeader(assignedTitle);
            if (h && h.dayNumber) detectedDay = h.dayNumber;
            detectedTitle = assignedTitle;
          }

          if (!detectedDay) {
            // Scan first 20 lines of the page
            const topLines = pageText.split(/\r?\n/).slice(0, 20);
            for (const l of topLines) {
              const h = this._detectDayHeader(l);
              if (h) {
                if (h.dayNumber) detectedDay = h.dayNumber;
                if (!detectedTitle) detectedTitle = h.title;
                break;
              }
            }
          }

          const targetDay = detectedDay || dayIndex;
          const finalDay = daysMap[String(targetDay)] ? dayIndex : targetDay;
          daysMap[String(finalDay)] = parsed;
          titlesMap[String(finalDay)] = detectedTitle || `Dia ${finalDay}`;
          dayIndex = Math.max(dayIndex, finalDay) + 1;
        }
      }
    }

    const dayKeys = Object.keys(daysMap).sort((a, b) => Number(a) - Number(b));
    let totalTimers = 0;
    dayKeys.forEach(k => { totalTimers += daysMap[k].length; });

    return {
      isMultiDay: dayKeys.length > 1,
      totalDays: dayKeys.length,
      totalTimers,
      days: daysMap,
      dayTitles: titlesMap
    };
  }

  /**
   * PDF text extraction using Dynamic Row Clustering and Tab-Separated Columns
   */
  static async extractPdfPages(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Biblioteca PDF.js ainda a carregar. Tente novamente em 2 segundos.');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    const titles = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Collect items with positions
      const items = [];
      for (const item of textContent.items) {
        const str = (item.str || '').trim();
        if (!str) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        const width = item.width || 0;
        const height = item.height || 10;
        items.push({ str, x, y, width, height });
      }

      if (items.length === 0) continue;

      // Sort items by Y descending (top of page first), then X ascending
      items.sort((a, b) => b.y - a.y || a.x - b.x);

      // Dynamic Row Clustering: items within ~5.5px belong to the same baseline
      const rows = [];
      for (const it of items) {
        let placed = false;
        for (const row of rows) {
          if (Math.abs(it.y - row.y) <= 5.5) {
            row.items.push(it);
            row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length;
            placed = true;
            break;
          }
        }
        if (!placed) {
          rows.push({ y: it.y, items: [it] });
        }
      }

      // Reconstruct lines, using tab separation between distinct columns
      const lines = rows.map(r => {
        r.items.sort((a, b) => a.x - b.x);
        let lineStr = '';
        let lastRight = null;
        for (const it of r.items) {
          if (lastRight !== null) {
            const gap = it.x - lastRight;
            if (gap > 16) {
              lineStr += '\t';
            } else if (gap > 2) {
              lineStr += ' ';
            }
          }
          lineStr += it.str;
          lastRight = it.x + it.width;
        }
        return lineStr;
      });

      const pageText = lines.join('\n');
      pages.push(pageText);
      titles.push(`Página ${pageNum}`);
    }

    return { pages, titles };
  }

  /**
   * Excel & CSV extraction with structured column support and sheet-name day preservation
   */
  static async extractSpreadsheetOrText(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (['xlsx', 'xls', 'csv'].includes(ext) && typeof XLSX !== 'undefined') {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const pages = [];
      const titles = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          dateNF: 'hh:mm',
          defval: ''
        });

        if (!rows || rows.length === 0) continue;

        // Check if rows have a "Dia" / "Day" column
        const headerRow = (rows[0] || []).map(c => String(c).trim().toLowerCase());
        const dayColIdx = headerRow.findIndex(c => /^(dia|day|data|date)$/i.test(c));

        if (dayColIdx !== -1 && rows.length > 2) {
          const dayGroups = new Map();
          for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.every(c => !c)) continue;
            const dayVal = String(row[dayColIdx] || '').trim();
            const groupKey = dayVal || '1';
            if (!dayGroups.has(groupKey)) dayGroups.set(groupKey, []);
            dayGroups.get(groupKey).push(row.filter((_, idx) => idx !== dayColIdx).join('\t'));
          }

          if (dayGroups.size > 1) {
            for (const [dKey, dRows] of dayGroups.entries()) {
              const dNum = parseInt(dKey, 10) || null;
              const title = dNum ? `Dia ${dNum}` : `Dia ${dKey}`;
              pages.push(`=== ${title} ===\n` + dRows.join('\n'));
              titles.push(title);
            }
            continue;
          }
        }

        // Standard sheet
        const sheetText = rows
          .map(r => (r || []).map(cell => String(cell || '').trim()).filter(Boolean).join('\t'))
          .filter(Boolean)
          .join('\n');

        pages.push(`=== ${sheetName} ===\n` + sheetText);
        titles.push(sheetName);
      }

      return { pages, titles };
    }

    const txt = await file.text();
    return { pages: [txt], titles: ['Documento'] };
  }
}

window.ScheduleImporter = ScheduleImporter;
