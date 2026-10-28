/**
 * StageTimer Smart Schedule Importer (v4 - Paulo Ferrão Produções Calibrated)
 * Advanced timetable & schedule parser for PDF, Excel (.xlsx, .xls, .csv), and pasted text.
 *
 * Core Principles:
 * 1. PRIORITIZES ON STAGE (ATUAÇÃO):
 *    - The main artist entry ALWAYS receives the real On Stage performance time!
 *    - Never confused with Load In (arrival of gear) or Soundcheck (afternoon rehearsal).
 * 2. SOUNDCHECKS INCLUDED:
 *    - Automatically identifies afternoon soundchecks (11:00 to 21:30) and creates separate timers:
 *      e.g. "Hinoportuna (Soundcheck) 18:45 – 19:30".
 * 3. CHANGEOVERS INCLUDED:
 *    - Automatically identifies changeovers/line checks preceding an act and creates timers:
 *      e.g. "Hinoportuna (Changeover) 00:30 – 00:35".
 * 4. LOAD-IN & CURFEW ISOLATION:
 *    - Load-in intervals (e.g. "18h30 > 18h45" or "14:00 | 17:00") and Curfews are never converted to timers.
 * 5. ALL SEPARATORS SUPPORTED:
 *    - ">", "|", "-", "–", "—", "~", "às", "as", "até", "ate", "a", "to", "->", "/"
 * 6. MULTI-DAY DETECTION:
 *    - Detects explicit dates ("05 de novembro de 2025", "23 outubro 2025", "18 maio 2026"), "Dia X", days of week, and multi-page PDFs.
 * 7. MULTIPLE SLOTS PRESERVED:
 *    - If an artist performs multiple times (e.g. Dj Residente opening at 23:00 and closing at 04:30), both slots are preserved.
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

    // Match "23:00", "23.00", "23h00", "23H00", "23h15", "4h30", "01:30", "23h"
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
      notes: '', // Clean empty notes
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
   * Regex matching individual time tokens: 23:00, 23.00, 23h00, 23H00, 23h, 4h30, 0h
   */
  static _getTimeTokenRegex() {
    return /\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b/gi;
  }

  /**
   * Regex matching time ranges strictly with explicit range connectors:
   * "-", "–", "—", "~", "às", "as", "até", "ate", "a", "to", "till", "until", "->", ">", "=>", "/", "|"
   * IMPORTANT: Does NOT allow tabs or spaces across columns to prevent mashing different columns together!
   */
  static _getTimeRangeRegex() {
    return /(\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b)\s*(?:[-–—~]|às|as|até|ate|\ba\b|\bto\b|\btill\b|\buntil\b|-->?|>|=>|\/|\\|\|)\s*(\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b)/gi;
  }

  /**
   * Check if a line is purely a table header or production metadata (not an artist row)
   */
  static _isHeaderOrMetaLine(line) {
    const l = (line || '').trim().toLowerCase();
    if (!l) return true;

    // Header column names without concrete artist times
    if (/^(artist|artista|hor[áa]rio|palco|stage|lineup|line-up|programação|programa|data|dia|day|load-?in|set\s*up|soundcheck|change-?over|on\s*stage|curfew|obs|observa[çc][õo]es|contacto[s]?|rider|catering)\b/i.test(l) &&
        !/\d{1,2}\s*[:.hH]/.test(l)) {
      return true;
    }
    // Production notices and footer info
    if (/^(a\s*impossibilidade|regras|normas|contacto[s]?\s*de\s*produção|respons[áa]vel|ficheiro|página|stage\s*manager|produção|load-in\s*[:|])/i.test(l)) {
      return true;
    }
    // Pure note lines (e.g. "***ESTE HORÁRIO JÁ CONSIDERA...")
    if (/^(?:[*]+\s*)?nota\s*:/i.test(l) || /^[*]{2,}/.test(l)) {
      return true;
    }
    return false;
  }

  /**
   * Extract clean artist name by removing matched times, durations "(60m)", "n/a", curfew and punctuation
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

    // Remove standalone time tokens (e.g. single curfew times)
    clean = clean.replace(/\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d|\s*[hH])\b/gi, ' ');

    // Remove duration notes like "(60m)", "(140min)", "(30m)"
    clean = clean.replace(/\s*\(\s*\d+\s*m(?:in)?\s*\)/gi, ' ');

    // Remove asterisks denoting notes
    clean = clean.replace(/[*]+/g, ' ');

    // Remove "n/a" indicators
    clean = clean.replace(/\bn\s*\/\s*a\b/gi, ' ');

    // Remove common column header words if left behind
    clean = clean.replace(/\b(?:artist|artista|load-?in|soundcheck|set\s*up|change-?over|line\s*check|on\s*stage|palco|stage|live|hora|hor[áa]rio)\b/gi, ' ');

    // Remove table borders, tabs, bullet characters, leading/trailing punctuation
    clean = clean.replace(/[|•\t;~_]+/g, ' ');
    clean = clean.replace(/\s+/g, ' ');
    clean = clean.replace(/^[\s\-–—:=/]+|[\s\-–—:=/]+$/g, '').trim();

    return clean;
  }

  /**
   * Classify time ranges for an artist into Soundcheck, Changeover, and On Stage.
   * ALWAYS prioritizes the On Stage performance as the artist's main entry!
   * Ignores Load-In intervals!
   */
  static _classifyArtistRanges(line, matches, artistName) {
    if (!matches || matches.length === 0) return { soundchecks: [], changeovers: [], onStage: null };

    const parsed = matches.map(m => {
      const startStr = m[1];
      const endStr = m[2];
      const sMins = this.parseTimeStrToMinutes(startStr);
      const eMins = this.parseTimeStrToMinutes(endStr);
      let diff = (eMins !== null && sMins !== null) ? eMins - sMins : 60;
      if (diff <= 0) diff += 1440;

      return {
        raw: m[0],
        startStr,
        endStr,
        startMins: sMins,
        endMins: eMins,
        durMins: diff,
        durationMs: diff * 60000
      };
    });

    let soundcheck = null;
    let changeover = null;
    let onStage = null;

    if (parsed.length === 1) {
      // 1 single range -> This is ALWAYS On Stage!
      onStage = parsed[0];
    } else if (parsed.length === 2) {
      // 2 ranges:
      // Last range is ALWAYS On Stage!
      onStage = parsed[1];
      const first = parsed[0];

      // Check if first range is Changeover:
      // It is Changeover if its end connects directly (or within 15 mins) to On Stage,
      // its duration is <= 45m, and it occurs during event night/morning (>= 21:00 or < 06:00)
      let gapToStage = (onStage.startMins !== null && first.endMins !== null) ? onStage.startMins - first.endMins : 999;
      if (gapToStage < 0) gapToStage += 1440;

      const isNightTime = first.startMins !== null && (first.startMins >= 21 * 60 || first.startMins < 6 * 60);

      if (gapToStage <= 15 && first.durMins <= 45 && isNightTime) {
        changeover = first;
      } else if (first.startMins !== null && first.startMins >= 11 * 60 && first.startMins <= 21.5 * 60 && first.durMins >= 20) {
        // Afternoon/evening soundcheck (11:00 to 21:30)
        soundcheck = first;
      } else {
        // Otherwise it is Load-In (e.g. Dj Pablu 02h15 > 02h30)! Ignored!
      }
    } else if (parsed.length === 3) {
      // 3 ranges:
      // Last range is ALWAYS On Stage!
      onStage = parsed[2];
      const mid = parsed[1];
      const first = parsed[0];

      let gapMidToStage = (onStage.startMins !== null && mid.endMins !== null) ? onStage.startMins - mid.endMins : 999;
      if (gapMidToStage < 0) gapMidToStage += 1440;

      if (gapMidToStage <= 15 && mid.durMins <= 45) {
        // Middle is Changeover! (e.g. Miss, Mister IPVC or Minhotos Marotos)
        changeover = mid;
        // Check if first range is Soundcheck (afternoon) or Load-In (night)
        if (first.startMins !== null && first.startMins >= 11 * 60 && first.startMins <= 21.5 * 60 && first.durMins >= 20) {
          soundcheck = first;
        }
        // If first is at night (e.g. 02h20 > 02h30), it was Load-In! Ignored!
      } else if (mid.startMins !== null && mid.startMins >= 11 * 60 && mid.startMins <= 21.5 * 60) {
        // Middle is Soundcheck! (e.g. Tunice: 19h15>19h30 Load-in, 19h30>20h00 Soundcheck, 00h00>00h30 On Stage)
        soundcheck = mid;
      } else if (first.startMins !== null && first.startMins >= 11 * 60 && first.startMins <= 21.5 * 60) {
        soundcheck = first;
      }
    } else if (parsed.length >= 4) {
      // 4 ranges: Load-in [0], Soundcheck [1], Changeover [2], On Stage [3]!
      // (e.g. Hinoportuna, A.H.P., KBK, ProfJam)
      soundcheck = parsed[1];
      changeover = parsed[2];
      onStage = parsed[3];
    }

    // Check if line contains explicit duration annotation: e.g. "(180min)", "(60m)", "(55min)", "(25min)"
    // Essential for daylight savings transitions (e.g. 23:00 to 01:00 = 180min) and exact production timer accuracy
    const mExplicitDur = (line || '').match(/\(\s*(\d+)\s*m(?:in)?\s*\)/i);
    if (mExplicitDur && onStage) {
      const explicitMins = parseInt(mExplicitDur[1], 10);
      if (explicitMins > 0 && explicitMins <= 720) {
        onStage.durationMs = explicitMins * 60000;
      }
    }

    const soundchecks = soundcheck
      ? [this.makeTimerObj(`${artistName} (Soundcheck)`, soundcheck.startStr, soundcheck.endStr, soundcheck.durationMs)]
      : [];
    const changeovers = changeover
      ? [this.makeTimerObj(`${artistName} (Changeover)`, changeover.startStr, changeover.endStr, changeover.durationMs)]
      : [];
    const onStageTimer = onStage
      ? this.makeTimerObj(artistName, onStage.startStr, onStage.endStr, onStage.durationMs)
      : null;

    return { soundchecks, changeovers, onStage: onStageTimer };
  }

  /**
   * Sort timers in chronological festival sequence:
   * Afternoon soundchecks (11:00 - 21:00) -> Evening (21:00 - 23:59) -> Night/Morning acts (00:00 - 09:59)
   */
  static _getFestivalMinutes(timeRangeStr) {
    if (!timeRangeStr) return 9999;
    const firstTime = timeRangeStr.split(/[-–—~]/)[0].trim();
    const mins = this.parseTimeStrToMinutes(firstTime);
    if (mins === null) return 9999;
    // Festival day starts at 10:00 AM. Hours 00:00 to 09:59 belong to the night of the same festival day (+1440 mins)
    return mins < 10 * 60 ? mins + 1440 : mins;
  }

  static _sortTimersChronologically(timers) {
    return [...timers].sort((a, b) => {
      const aMin = this._getFestivalMinutes(a.startTime);
      const bMin = this._getFestivalMinutes(b.startTime);
      if (aMin !== bMin) return aMin - bMin;
      // If same start time, put Soundcheck first, then Changeover, then On Stage
      const getPriority = (name) => {
        if (name.includes('(Soundcheck)')) return 1;
        if (name.includes('(Changeover)')) return 2;
        return 3;
      };
      return getPriority(a.name) - getPriority(b.name);
    });
  }

  /**
   * Fallback parser for timetables that only list single start times per row
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
      name = name.replace(/\s*\(\s*\d+\s*m(?:in)?\s*\)/gi, ' ');
      name = name.replace(/[*]+/g, ' ');
      name = name.replace(/\bn\s*\/\s*a\b/gi, ' ');
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
        // Last artist: default 60 minutes
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
   * - includeSoundchecks: boolean (default true)
   * - includeChangeovers: boolean (default true)
   */
  static parseTextToTimers(rawText, options = {}) {
    const includeSoundchecks = options.includeSoundchecks !== false; // Default: TRUE
    const includeChangeovers = options.includeChangeovers !== false; // Default: TRUE
    if (!rawText) return [];

    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.replace(/\u00A0/g, ' ').trim())
      .filter(Boolean);

    const allTimers = [];
    const rangeRegex = this._getTimeRangeRegex();

    for (const line of lines) {
      if (this._isHeaderOrMetaLine(line)) continue;

      const matches = [...line.matchAll(rangeRegex)];
      if (matches.length > 0) {
        const artistName = this._cleanArtistName(line, matches);
        if (!artistName || artistName.length < 2) continue;

        const classified = this._classifyArtistRanges(line, matches, artistName);

        if (includeSoundchecks && classified.soundchecks.length > 0) {
          allTimers.push(...classified.soundchecks);
        }
        if (includeChangeovers && classified.changeovers.length > 0) {
          allTimers.push(...classified.changeovers);
        }
        if (classified.onStage) {
          allTimers.push(classified.onStage);
        }
      }
    }

    if (allTimers.length === 0) {
      // Fallback: Check if schedule uses single start times per row
      return this._parseSingleStartTimeLines(lines);
    }

    // Sort all timers in chronological festival order
    return this._sortTimersChronologically(allTimers);
  }

  /**
   * Helper to detect if a line is a Day Header (05 de novembro de 2025, 23 outubro, Dia 1, Sexta, etc.)
   */
  static _detectDayHeader(line) {
    if (!line) return null;
    const l = line.trim();

    // 1. Full or short date: "05 de novembro de 2025", "23 outubro 2025", "18 maio 2026", "24/10"
    const mDate = l.match(/\b(\d{1,2})\s*(?:de\s+)?(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:\s*(?:de\s+)?\d{2,4})?\b/i) ||
                  l.match(/^\s*(?:===+\s*)?(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-]\d{2,4})?\b/i);
    if (mDate) {
      return { dayNumber: null, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, ''), isDate: true };
    }

    // 2. Explicit "Dia X" or "Day X"
    const mDia = l.match(/\b(?:dia|day)\s*0?(\d{1,2})\b/i);
    if (mDia) {
      const num = parseInt(mDia[1], 10);
      return { dayNumber: num, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, '') };
    }

    // 3. Ordinal Day ("1º Dia", "2º Dia", "1ª Noite")
    const mOrd = l.match(/\b(\d{1,2})\s*[ºªo\.]*\s*(?:dia|noite)\b/i);
    if (mOrd) {
      const num = parseInt(mOrd[1], 10);
      return { dayNumber: num, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, '') };
    }

    // 4. Days of the week in Portuguese / English
    const mWeek = l.match(/\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:-feira|\s*feira)?\b/i);
    if (mWeek) {
      return { dayNumber: null, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, ''), isWeekDay: true };
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

      // Check if line is a day header (and NOT an artist row with time range)
      const hasTimeRange = rangeRegex.test(trimmed);
      rangeRegex.lastIndex = 0;

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
   * - includeSoundchecks: boolean (default true)
   * - includeChangeovers: boolean (default true)
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

          if (assignedTitle && assignedTitle !== `Dia ${p + 1}`) {
            const h = this._detectDayHeader(assignedTitle);
            if (h && h.dayNumber) detectedDay = h.dayNumber;
            detectedTitle = assignedTitle;
          }

          if (!detectedDay || !detectedTitle) {
            // Scan first 15 lines of the page for explicit date or day header
            const topLines = pageText.split(/\r?\n/).slice(0, 15);
            for (const l of topLines) {
              const h = this._detectDayHeader(l);
              if (h) {
                if (h.dayNumber) detectedDay = h.dayNumber;
                detectedTitle = h.title;
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

      // Dynamic Row Clustering
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
      titles.push(`Dia ${pageNum}`);
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
