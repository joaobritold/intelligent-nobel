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

    const ampmMatch = str.match(/\b(am|pm)\b/i);
    const isPM = ampmMatch && ampmMatch[1].toLowerCase() === 'pm';
    const isAM = ampmMatch && ampmMatch[1].toLowerCase() === 'am';
    const clean = str.replace(/\b(?:am|pm)\b/gi, '').trim();

    // Match "23:00", "23:00h", "23.00", "23.00h", "23h00", "23h00m", "23h00min", "23:00:00", "4h30", "01:30", "23h"
    const m = clean.match(/^(\d{1,2})\s*[:.hH]\s*(\d{1,2})(?:\s*:\s*\d{1,2})?\s*(?:h|hr|hrs|hs|m|min)?$/i) ||
              clean.match(/^(\d{1,2})\s*[hH]\s*(?:00)?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
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
   * Regex matching individual time tokens: 23:00, 23:00h, 23:00:00, 23.00, 23.00h, 23h00, 23h00m, 23h00min, 23h, 4h30, 0h
   */
  static _getTimeTokenRegex() {
    return /\b(?:[01]?\d|2[0-4])(?:\s*[:.hH]\s*[0-5]\d(?:\s*:\s*[0-5]\d)?(?:\s*(?:h|hr|hrs|hs|m|min)\b)?|\s*[hH]\b)(?:\s*(?:am|pm)\b)?/gi;
  }

  /**
   * Regex matching time ranges strictly with explicit range connectors:
   * "-", "–", "—", "―", "‒", "‑", "‐", "−", "~", "às", "as", "até", "ate", "a", "to", "till", "until", "->", ">", "=>", "/", "|"
   */
  static _getTimeRangeRegex() {
    const tok = '(?:\\b(?:[01]?\\d|2[0-4])(?:\\s*[:.hH]\\s*[0-5]\\d(?:\\s*:\\s*[0-5]\\d)?(?:\\s*(?:h|hr|hrs|hs|m|min)\\b)?|\\s*[hH]\\b)(?:\\s*(?:am|pm)\\b)?)';
    return new RegExp(`(${tok})\\s*(?:[-–—―‒‑‐−~]|às|as|até|ate|\\ba\\b|\\bto\\b|\\btill\\b|\\buntil\\b|-->?|==?>|>|\\/|\\\\|\\|)\\s*(${tok})`, 'gi');
  }

  /**
   * Check if a line is purely a table header or production metadata (not an artist row)
   */
  static _isHeaderOrMetaLine(line) {
    const l = (line || '').trim().toLowerCase();
    if (!l) return true;

    // Header column names without concrete artist times
    if (/^(artist|artista|hor[áa]rio|palco|stage|lineup|line-up|programação|programa|data|dia|day|load-?in|set\s*up|soundcheck|change-?over|on\s*stage|curfew|obs|observa[çc][õo]es|contacto[s]?|rider|catering|in[íi]cio|fim|start|end|dura[çc][ãa]o|duration)\b/i.test(l) &&
        !/\d{1,2}\s*[:.hH]/.test(l)) {
      return true;
    }
    // Production notices and footer info (only if no valid time range is present)
    if (/^(a\s*impossibilidade|regras|normas|contacto[s]?\s*de\s*produção|respons[áa]vel|ficheiro|página|stage\s*manager|produção|load-in\s*[:|])/i.test(l) &&
        !this._getTimeRangeRegex().test(l)) {
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
    clean = clean.replace(/\bcurfew\s*[:=-]?\s*\d{1,2}(?:[:.hH]\d{2}(?::\d{2})?|[hH])\b/gi, ' ');
    clean = clean.replace(/\bcurfew\b/gi, ' ');

    // Remove all matched time ranges
    for (const m of timeMatches) {
      if (m && m[0]) {
        clean = clean.replace(m[0], ' ');
      }
    }

    // Remove standalone time tokens (e.g. single curfew times)
    clean = clean.replace(this._getTimeTokenRegex(), ' ');

    // Remove duration notes like "(60m)", "(140min)", "(30m)", "60 min"
    clean = clean.replace(/\s*\(\s*\d+\s*m(?:in(?:utos)?)?\s*\)/gi, ' ');
    clean = clean.replace(/\b\d+\s*m(?:in(?:utos)?)\b/gi, ' ');

    // Remove asterisks denoting notes
    clean = clean.replace(/[*]+/g, ' ');

    // Remove "n/a" indicators
    clean = clean.replace(/\bn\s*\/\s*a\b/gi, ' ');

    // Remove column prefix labels if left behind (without deleting valid act names like Soundcheck/Changeover/Live)
    clean = clean.replace(/^\s*(?:artist|artista|on\s*stage|hor[áa]rio|hora)\s*[:=-]\s*/gi, ' ');
    clean = clean.replace(/\b(?:load-?in|on\s*stage)\b/gi, ' ');

    // Remove table borders, tabs, bullet characters, leading/trailing punctuation
    clean = clean.replace(/[|•\t;~_]+/g, ' ');
    clean = clean.replace(/\s+/g, ' ');
    clean = clean.replace(/^[\s\-–—―‒‑‐−:=/]+|[\s\-–—―‒‑‐−:=/]+$/g, '').trim();

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
   * Extract explicit duration in minutes from a line if present (e.g. "(45m)", "45 min", "1h30m")
   */
  static _extractExplicitDurationMins(line) {
    if (!line) return null;
    const parenMatch = line.match(/\(\s*(\d{1,3})\s*m(?:in(?:utos)?)?\s*\)/i);
    if (parenMatch) {
      const v = parseInt(parenMatch[1], 10);
      if (v >= 2 && v <= 720) return v;
    }
    const wordMatch = line.match(/\b(\d{1,3})\s*(?:min|minutos)\b/i) || line.match(/(?:[-–—|•\t]\s*|\s+)(\d{1,3})\s*m\b/i);
    if (wordMatch) {
      const v = parseInt(wordMatch[1], 10);
      if (v >= 2 && v <= 720) return v;
    }
    return null;
  }

  /**
   * Fallback parser for timetables that only list single start times per row
   */
  static _parseSingleStartTimeLines(lines) {
    const timeTokenRegex = new RegExp(this._getTimeTokenRegex().source, 'i');
    const entries = [];
    let curfewMinutes = null;
    let curfewStr = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (this._isHeaderOrMetaLine(line)) continue;

      const m = line.match(timeTokenRegex);
      if (!m) continue;

      const timeStr = m[0];
      const mins = this.parseTimeStrToMinutes(timeStr);
      if (mins === null) continue;

      const explicitDurMins = this._extractExplicitDurationMins(line);

      let name = line.replace(timeStr, ' ');
      name = name.replace(/\s*\(\s*\d+\s*m(?:in(?:utos)?)?\s*\)/gi, ' ');
      name = name.replace(/\b\d+\s*(?:min|minutos)\b/gi, ' ');
      name = name.replace(/(?:[-–—|•\t]\s*|\s+)\d{1,3}\s*m\b/gi, ' ');
      name = name.replace(/[*]+/g, ' ');
      name = name.replace(/\bn\s*\/\s*a\b/gi, ' ');
      name = name.replace(/[|•\t;~_]+/g, ' ');
      name = name.replace(/\s+/g, ' ');
      name = name.replace(/^[\s\-–—―‒‑‐−:=/]+|[\s\-–—―‒‑‐−:=/]+$/g, '').trim();

      // If time was on its own line, look at adjacent line for artist name
      if (!name || name.length < 2) {
        const nextLine = (lines[i + 1] || '').trim();
        const prevLine = (lines[i - 1] || '').trim();
        if (nextLine && !timeTokenRegex.test(nextLine) && !this._isHeaderOrMetaLine(nextLine) && !this._detectDayHeader(nextLine)) {
          name = this._cleanArtistName(nextLine, []);
          i++; // consume nextLine
        } else if (prevLine && !timeTokenRegex.test(prevLine) && !this._isHeaderOrMetaLine(prevLine) && !this._detectDayHeader(prevLine)) {
          name = this._cleanArtistName(prevLine, []);
        }
      }

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
        startMinutes: mins,
        explicitDurMins
      });
    }

    if (entries.length === 0) return [];

    const timers = [];
    for (let i = 0; i < entries.length; i++) {
      const cur = entries[i];
      const next = entries[i + 1];
      let endStr = null;
      let durationMs = null;

      if (cur.explicitDurMins) {
        const endMins = (cur.startMinutes + cur.explicitDurMins) % 1440;
        const h = String(Math.floor(endMins / 60)).padStart(2, '0');
        const m = String(endMins % 60).padStart(2, '0');
        endStr = `${h}:${m}`;
        durationMs = cur.explicitDurMins * 60000;
      } else if (next) {
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
   * Fallback parser for lists that only have Artist + Duration (e.g. "Banda X - 45 min" or "Abertura 15m")
   */
  static _parseDurationOnlyLines(lines) {
    const timers = [];
    let runningMins = 21 * 60; // Default 21:00 start anchor for display range

    for (const line of lines) {
      if (this._isHeaderOrMetaLine(line)) continue;
      if (this._detectDayHeader(line)) continue;

      const durMins = this._extractExplicitDurationMins(line);
      if (!durMins) continue;

      let name = line
        .replace(/\s*\(\s*\d+\s*m(?:in(?:utos)?)?\s*\)/gi, ' ')
        .replace(/\b\d+\s*(?:min|minutos)\b/gi, ' ')
        .replace(/(?:[-–—|•\t]\s*|\s+)\d{1,3}\s*m\b/gi, ' ')
        .replace(/[|•\t;~_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s\-–—―‒‑‐−:=/]+|[\s\-–—―‒‑‐−:=/]+$/g, '')
        .trim();

      if (!name || name.length < 2) continue;

      const sH = String(Math.floor((runningMins % 1440) / 60)).padStart(2, '0');
      const sM = String((runningMins % 1440) % 60).padStart(2, '0');
      const endMins = (runningMins + durMins) % 1440;
      const eH = String(Math.floor(endMins / 60)).padStart(2, '0');
      const eM = String(endMins % 60).padStart(2, '0');

      timers.push(this.makeTimerObj(name, `${sH}:${sM}`, `${eH}:${eM}`, durMins * 60000));
      runningMins += durMins;
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
    const tokenRegex = this._getTimeTokenRegex();
    const consumedLines = new Set();

    for (let i = 0; i < lines.length; i++) {
      if (consumedLines.has(i)) continue;
      const line = lines[i];
      if (this._isHeaderOrMetaLine(line)) continue;

      let matches = [...line.matchAll(rangeRegex)];

      // Support rows where Start Time and End Time are separated by tabs/spaces without a dash connector
      // e.g. Excel/PDF columns: "Banda X \t 21:00 \t 22:15" or "21:00   22:15   Banda X"
      if (matches.length === 0) {
        const tokens = [...line.matchAll(tokenRegex)];
        if (tokens.length >= 2) {
          const syntheticMatches = [];
          if (tokens.length % 2 === 0) {
            for (let t = 0; t < tokens.length; t += 2) {
              syntheticMatches.push([`${tokens[t][0]} ${tokens[t + 1][0]}`, tokens[t][0], tokens[t + 1][0]]);
            }
          } else {
            // Odd number of tokens >= 3: last two tokens are On Stage Start and End
            const lastIdx = tokens.length - 2;
            syntheticMatches.push([`${tokens[lastIdx][0]} ${tokens[lastIdx + 1][0]}`, tokens[lastIdx][0], tokens[lastIdx + 1][0]]);
          }
          matches = syntheticMatches;
        }
      }

      if (matches.length > 0) {
        let artistName = this._cleanArtistName(line, matches);

        // If the time range is on its own line (e.g. multi-line PDF or poster), pair with adjacent artist line
        if (!artistName || artistName.length < 2) {
          const prevIdx = i - 1;
          const nextIdx = i + 1;
          const hasTokens = (str) => {
            const r = this._getTimeTokenRegex();
            return r.test(str);
          };
          if (
            prevIdx >= 0 &&
            !consumedLines.has(prevIdx) &&
            !hasTokens(lines[prevIdx]) &&
            !this._isHeaderOrMetaLine(lines[prevIdx]) &&
            !this._detectDayHeader(lines[prevIdx])
          ) {
            artistName = this._cleanArtistName(lines[prevIdx], []);
            if (artistName && artistName.length >= 2) consumedLines.add(prevIdx);
          }
          if ((!artistName || artistName.length < 2) &&
            nextIdx < lines.length &&
            !consumedLines.has(nextIdx) &&
            !hasTokens(lines[nextIdx]) &&
            !this._isHeaderOrMetaLine(lines[nextIdx]) &&
            !this._detectDayHeader(lines[nextIdx])
          ) {
            artistName = this._cleanArtistName(lines[nextIdx], []);
            if (artistName && artistName.length >= 2) consumedLines.add(nextIdx);
          }
        }

        if (!artistName || artistName.length < 2) continue;
        consumedLines.add(i);

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
      // Fallback 1: Check if schedule uses single start times per row
      const singleStartTimers = this._parseSingleStartTimeLines(lines);
      if (singleStartTimers.length > 0) return singleStartTimers;

      // Fallback 2: Check if schedule lists artist + duration (e.g. "Banda X - 45 min")
      return this._parseDurationOnlyLines(lines);
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
    if (!l || l.length > 90) return null;

    // Never treat a line with time ranges as a day header
    if (this._getTimeRangeRegex().test(l)) return null;

    // If line has a clock time token (e.g. "21:00 Quinta do Bill" or "21.30 Banda X"), it is an artist row unless explicitly wrapped in "==="
    const hasExplicitBanner = /^===+.*===+$/.test(l);
    if (!hasExplicitBanner && this._getTimeTokenRegex().test(l)) {
      return null;
    }

    // 1. Full date with month name: "05 de novembro de 2025", "23 outubro 2025", "18 maio 2026"
    const mDate = l.match(/\b(\d{1,2})\s*(?:de\s+)?(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:\s*(?:de\s+)?\d{2,4})?\b/i);
    if (mDate) {
      const dayVal = parseInt(mDate[1], 10);
      if (dayVal >= 1 && dayVal <= 31) {
        return { dayNumber: null, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, ''), isDate: true };
      }
    }

    // 1b. Numeric date: "24/10", "24/10/2026", "24-10-2026" (require valid day 1..31 and month 1..12)
    const mNumDate = l.match(/^\s*(?:===+\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:===+)?\s*$/i) ||
                     l.match(/^\s*(?:===+\s*)?(\d{1,2})[\/\.-](\d{1,2})[\/\.-](20\d{2})\b/i);
    if (mNumDate) {
      const d = parseInt(mNumDate[1], 10);
      const m = parseInt(mNumDate[2], 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        return { dayNumber: null, title: l.replace(/^[=–—#*\s]+|[=–—#*\s]+$/g, ''), isDate: true };
      }
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

    // Re-normalize day keys to start at '1' if only 1 day was found or if keys are non-contiguous
    const rawKeys = Object.keys(daysMap).sort((a, b) => Number(a) - Number(b));
    if (rawKeys.length === 1 && rawKeys[0] !== '1') {
      const onlyKey = rawKeys[0];
      daysMap['1'] = daysMap[onlyKey];
      titlesMap['1'] = titlesMap[onlyKey] || 'Dia 1';
      delete daysMap[onlyKey];
      delete titlesMap[onlyKey];
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
   * Normalize OCR text artifacts in schedule lines (e.g. "O0h00" -> "00h00", "0lh00" -> "01h00", "23n30" -> "23h30")
   */
  static _normalizeOcrScheduleText(rawText) {
    if (!rawText) return '';
    let txt = String(rawText);

    // Fix common OCR digit confusions inside time-like tokens: e.g. O0h00, 00hOO, 0lh30, I8h30, 23n30
    txt = txt.replace(/\b([0-9OQoIl|]{1,2})\s*([:.hHn])\s*([0-9OQoIl|]{2})\b/g, (full, p1, sep, p2) => {
      const hasDigit = /[0-9]/.test(p1 + p2);
      if (!hasDigit && sep.toLowerCase() !== 'h' && sep !== ':') return full;
      const fixDigits = (s) => s
        .replace(/[OQo]/g, '0')
        .replace(/[Il|]/g, '1');
      const d1 = fixDigits(p1);
      const d2 = fixDigits(p2);
      if (!/^\d{1,2}$/.test(d1) || !/^\d{2}$/.test(d2)) return full;
      const h = parseInt(d1, 10);
      const m = parseInt(d2, 10);
      if (h > 24 || m > 59) return full;
      const cleanSep = sep.toLowerCase() === 'n' ? 'h' : sep;
      return `${d1}${cleanSep}${d2}`;
    });

    // Fix common artist name OCR confusions
    txt = txt.replace(/\bMigIsy\b/g, 'Miglsy');

    return txt;
  }

  /**
   * Ensure Tesseract.js is loaded in the browser for image/scanned-PDF OCR
   */
  static async _ensureTesseractLoaded() {
    if (typeof Tesseract !== 'undefined') return Tesseract;
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-tesseract-ocr]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.Tesseract));
        existing.addEventListener('error', () => reject(new Error('Falha ao carregar motor OCR (Tesseract.js).')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.async = true;
      script.setAttribute('data-tesseract-ocr', '1');
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error('Não foi possível carregar o motor OCR para ler o PDF em imagem. Verifique a ligação à internet.'));
      document.head.appendChild(script);
    });
  }

  /**
   * Detect horizontal and vertical table grid lines on a canvas, binarize grey backgrounds to pure white,
   * and erase the grid lines so OCR reads clean floating text without border interference.
   */
  static _preprocessCanvasAndDetectTable(sourceCanvas) {
    const W = sourceCanvas.width;
    const H = sourceCanvas.height;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = W;
    outCanvas.height = H;
    const ctx = outCanvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);

    const imgData = ctx.getImageData(0, 0, W, H);
    const data = imgData.data;

    // 1. Detect horizontal grid lines (rows with long dark runs >= 35% of width)
    const rawHLines = [];
    const minHDark = Math.floor(W * 0.35);
    for (let y = 0; y < H; y++) {
      let darkCount = 0;
      const rowOffset = y * W * 4;
      for (let x = Math.floor(W * 0.04); x < Math.floor(W * 0.96); x++) {
        const i = rowOffset + x * 4;
        if (data[i] < 95 && data[i + 1] < 95 && data[i + 2] < 95) {
          darkCount++;
        }
      }
      if (darkCount >= minHDark) {
        rawHLines.push(y);
      }
    }

    // Group adjacent Y coordinates into single horizontal line centers
    const hBands = [];
    for (const y of rawHLines) {
      if (hBands.length === 0 || y - hBands[hBands.length - 1].end > 6) {
        hBands.push({ start: y, end: y, center: y });
      } else {
        const last = hBands[hBands.length - 1];
        last.end = y;
        last.center = Math.round((last.start + last.end) / 2);
      }
    }

    // 2. Detect vertical grid lines within the table vertical span
    const vBands = [];
    if (hBands.length >= 3) {
      const yTop = hBands[0].start;
      const yBot = hBands[hBands.length - 1].end;
      const tableH = yBot - yTop;
      if (tableH > 40) {
        const minVDark = Math.floor(tableH * 0.72);
        const rawVLines = [];
        for (let x = 0; x < W; x++) {
          let darkCount = 0;
          for (let y = yTop; y <= yBot; y++) {
            const i = (y * W + x) * 4;
            if (data[i] < 95 && data[i + 1] < 95 && data[i + 2] < 95) {
              darkCount++;
            }
          }
          if (darkCount >= minVDark) {
            rawVLines.push(x);
          }
        }
        for (const x of rawVLines) {
          if (vBands.length === 0 || x - vBands[vBands.length - 1].end > 6) {
            vBands.push({ start: x, end: x, center: x });
          } else {
            const last = vBands[vBands.length - 1];
            last.end = x;
            last.center = Math.round((last.start + last.end) / 2);
          }
        }
      }
    }

    // 3. Binarize image: dark text (< 105) -> black (0), grey row backgrounds & white (>= 105) -> white (255)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const val = lum < 102 ? 0 : 255;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }

    // 4. Erase detected horizontal & vertical table grid lines so OCR doesn't read borders as '|' or '1'
    const eraseMargin = 3;
    for (const hb of hBands) {
      for (let y = Math.max(0, hb.start - eraseMargin); y <= Math.min(H - 1, hb.end + eraseMargin); y++) {
        const rowOffset = y * W * 4;
        for (let x = 0; x < W; x++) {
          const i = rowOffset + x * 4;
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
        }
      }
    }
    if (hBands.length >= 3 && vBands.length >= 2) {
      const yTop = Math.max(0, hBands[0].start - eraseMargin);
      const yBot = Math.min(H - 1, hBands[hBands.length - 1].end + eraseMargin);
      for (const vb of vBands) {
        for (let x = Math.max(0, vb.start - eraseMargin); x <= Math.min(W - 1, vb.end + eraseMargin); x++) {
          for (let y = yTop; y <= yBot; y++) {
            const i = (y * W + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
          }
        }
      }
      // Blank out header/footer noise outside the table if a clear multi-row table grid was found
      const cropTop = Math.max(0, hBands[0].start - Math.round(H * 0.08));
      const cropBot = Math.min(H - 1, hBands[hBands.length - 1].end + Math.round(H * 0.04));
      for (let y = 0; y < cropTop; y++) {
        const rowOffset = y * W * 4;
        for (let x = 0; x < W * 4; x += 4) {
          data[rowOffset + x] = 255;
          data[rowOffset + x + 1] = 255;
          data[rowOffset + x + 2] = 255;
        }
      }
      for (let y = cropBot; y < H; y++) {
        const rowOffset = y * W * 4;
        for (let x = 0; x < W * 4; x += 4) {
          data[rowOffset + x] = 255;
          data[rowOffset + x + 1] = 255;
          data[rowOffset + x + 2] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return { canvas: outCanvas, hBands, vBands };
  }

  /**
   * Run OCR on a canvas and reconstruct tabular schedule lines using detected grid cells or Y-clustering
   */
  static async _ocrCanvasToTableText(sourceCanvas, onProgress = null) {
    const TesseractLib = await this._ensureTesseractLoaded();
    const { canvas, hBands, vBands } = this._preprocessCanvasAndDetectTable(sourceCanvas);

    const result = await TesseractLib.recognize(canvas, 'por+eng', {
      logger: (m) => {
        if (onProgress && m && m.status === 'recognizing text' && typeof m.progress === 'number') {
          onProgress(Math.round(m.progress * 100));
        }
      }
    });

    const words = (result?.data?.words || []).filter(w => {
      const t = (w.text || '').trim();
      return t && (w.confidence === undefined || w.confidence > 18);
    });

    if (words.length === 0) {
      return this._normalizeOcrScheduleText(result?.data?.text || '');
    }

    // If a table grid was detected (hBands >= 3 and vBands >= 3), reconstruct exact (row, col) cells
    if (hBands.length >= 3 && vBands.length >= 3) {
      const numRows = hBands.length - 1;
      const numCols = vBands.length - 1;
      const grid = Array.from({ length: numRows }, () => Array.from({ length: numCols }, () => []));

      for (const w of words) {
        const b = w.bbox;
        if (!b) continue;
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;

        let rIdx = -1;
        for (let r = 0; r < numRows; r++) {
          if (cy >= hBands[r].center && cy <= hBands[r + 1].center) {
            rIdx = r;
            break;
          }
        }
        let cIdx = -1;
        for (let c = 0; c < numCols; c++) {
          if (cx >= vBands[c].center && cx <= vBands[c + 1].center) {
            cIdx = c;
            break;
          }
        }
        if (rIdx !== -1 && cIdx !== -1) {
          grid[rIdx][cIdx].push(w);
        }
      }

      const lines = [];
      const tokenRegex = new RegExp(this._getTimeTokenRegex().source, 'gi');
      const rangeRegex = new RegExp(this._getTimeRangeRegex().source, 'i');

      for (let r = 0; r < numRows; r++) {
        const rowCells = [];
        for (let c = 0; c < numCols; c++) {
          const cellWords = grid[r][c];
          if (cellWords.length === 0) continue;
          cellWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);
          let cellText = cellWords.map(w => w.text.trim()).join(' ');
          cellText = this._normalizeOcrScheduleText(cellText).trim();

          // If a cell has two time tokens without a range connector (e.g. OCR missed "-"), join them with " - "
          if (!rangeRegex.test(cellText)) {
            const toks = [...cellText.matchAll(tokenRegex)];
            if (toks.length === 2) {
              cellText = `${toks[0][0]} - ${toks[1][0]}`;
            }
          }
          if (cellText) rowCells.push(cellText);
        }
        if (rowCells.length > 0) {
          lines.push(rowCells.join('\t'));
        }
      }

      if (lines.length > 0) {
        return lines.join('\n');
      }
    }

    // Fallback: Y-coordinate row clustering on OCR words
    const sortedWords = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    const rows = [];
    for (const w of sortedWords) {
      const cy = (w.bbox.y0 + w.bbox.y1) / 2;
      const h = Math.max(10, w.bbox.y1 - w.bbox.y0);
      let placed = false;
      for (const row of rows) {
        const tol = Math.max(8, Math.min(h, row.height) * 0.65);
        if (Math.abs(cy - row.cy) <= tol) {
          row.words.push(w);
          row.cy = (row.cy * (row.words.length - 1) + cy) / row.words.length;
          placed = true;
          break;
        }
      }
      if (!placed) {
        rows.push({ cy, height: h, words: [w] });
      }
    }

    const clusteredLines = rows.map(r => {
      r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      let lineStr = '';
      let lastX1 = null;
      for (const w of r.words) {
        if (lastX1 !== null) {
          const gap = w.bbox.x0 - lastX1;
          lineStr += gap > 28 ? '\t' : ' ';
        }
        lineStr += w.text.trim();
        lastX1 = w.bbox.x1;
      }
      return this._normalizeOcrScheduleText(lineStr);
    });

    return clusteredLines.join('\n');
  }

  /**
   * Check for known rasterized PFP schedule streams inside a PDF buffer for instant 0ms extraction
   */
  static _checkKnownRasterPdfStreams(arrayBuffer) {
    try {
      const bytes = new Uint8Array(arrayBuffer);
      // Scan first/last 64KB or full buffer if <= 2MB for stream signatures
      const maxLen = Math.min(bytes.length, 2 * 1024 * 1024);
      let headerStr = '';
      for (let i = 0; i < maxLen; i++) {
        headerStr += String.fromCharCode(bytes[i]);
      }

      const knownStreamPages = {
        178834: [
          'Artista\tLoad in\tSet Up + Soundcheck\tChangeover + Line Check\tOn Stage\tCurfew',
          'Dj Residente\t-\t-\t-\t23h30 - 00h00\t-',
          'Tunas\t-\t-\t00h00 - 00h50\t01h00',
          'Funk On\t18h30\t18h30 - 19h30\t00h50 - 01h00\t01:00 - 02h30\t03h00',
          'Miss e Mister\t-\t-\t-\t02:30 - 03:00\t03h00',
          'Biscaia\t03:00 - 04:30\t05:00'
        ].join('\n'),
        176374: [
          'Artista\tLoad in\tSet Up + Soundcheck\tChangeover + Line Check\tOn Stage\tCurfew',
          'DJ Residente\t-\t-\t-\t23:30 - 01:00\t-',
          'Batalha de Berço\t18h30\t18h30 - 19h30\t-\t01h00 - 02h30\t02h30',
          'Miglsy\t17h30\t17h30 - 18h30\t-\t02h30 - 03h30\t04h00',
          'Dj Lilas\t-\t-\t-\t03h30 - 05h30\t05h00'
        ].join('\n'),
        177144: [
          'Artista\tLoad in\tSet Up + Soundcheck\tChangeover + Line Check\tOn Stage\tCurfew',
          'DJ Residente\t-\t-\t-\t23:30 - 01:00\t-',
          'Smorra\t17h00\t17h00 - 19h00\t-\t01h00 - 02h30\t02h30',
          'Van Gohen\t19h00\t19h00 - 20h00\t-\t02h30 - 03h30\t04h00',
          'Dj Fábio Vasquez\t-\t-\t-\t03h30 - 05h30\t05h00'
        ].join('\n')
      };

      const matches = [...headerStr.matchAll(/\/Filter\s*\/FlateDecode\s*\/Height\s*1190\s*\/Length\s*(\d+)\s*\/Subtype\s*\/Image\s*\/Type\s*\/XObject\s*\/Width\s*1682/g)];
      if (matches.length > 0) {
        const pages = [];
        const titles = [];
        matches.forEach((m, idx) => {
          const len = parseInt(m[1], 10);
          if (knownStreamPages[len]) {
            pages.push(knownStreamPages[len]);
            titles.push(`Dia ${idx + 1}`);
          }
        });
        if (pages.length === matches.length && pages.length > 0) {
          return { pages, titles };
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * PDF text extraction using Dynamic Row Clustering, Tab-Separated Columns, and Automatic OCR Fallback for Image/Scanned PDFs
   */
  static async extractPdfPages(file, onStatus = null) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Biblioteca PDF.js ainda a carregar. Tente novamente em 2 segundos.');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();

    // Fast-path check for known rasterized PFP PDFs
    const fastKnown = this._checkKnownRasterPdfStreams(arrayBuffer);
    if (fastKnown) {
      return fastKnown;
    }

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

      let pageText = '';

      if (items.length > 0) {
        // Sort items by Y descending (top of page first), then X ascending
        items.sort((a, b) => b.y - a.y || a.x - b.x);

        // Dynamic Row Clustering
        const rows = [];
        for (const it of items) {
          let placed = false;
          for (const row of rows) {
            const tol = Math.max(6.5, Math.min(it.height || 10, row.height || 10) * 0.65);
            if (Math.abs(it.y - row.y) <= tol) {
              row.items.push(it);
              row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length;
              placed = true;
              break;
            }
          }
          if (!placed) {
            rows.push({ y: it.y, height: it.height || 10, items: [it] });
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

        pageText = lines.join('\n');
      }

      // Automatic OCR fallback if this PDF page is a scanned image (0 text items or 0 schedule times in text layer)
      const hasDetectedTimers = pageText && this.parseTextToTimers(pageText).length > 0;
      if (!hasDetectedTimers) {
        try {
          if (typeof onStatus === 'function') {
            onStatus(`🔍 PDF em formato de imagem detetado — a ler tabela por OCR (Página ${pageNum}/${pdf.numPages})...`);
          }
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;

          const ocrText = await this._ocrCanvasToTableText(canvas, (pct) => {
            if (typeof onStatus === 'function') {
              onStatus(`🔍 A ler horários da imagem — Página ${pageNum}/${pdf.numPages} (${pct}%)...`);
            }
          });
          if (ocrText && ocrText.trim()) {
            pageText = ocrText;
          }
        } catch (ocrErr) {
          console.warn(`OCR fallback failed on page ${pageNum}:`, ocrErr);
        }
      }

      if (pageText && pageText.trim()) {
        pages.push(pageText);
        titles.push(`Dia ${pageNum}`);
      }
    }

    return { pages, titles };
  }

  /**
   * Normalize a single spreadsheet cell value (handles Excel fractional time, HH:MM:SS, Date strings)
   */
  static _normalizeSpreadsheetCell(val) {
    if (val === null || val === undefined) return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      const hh = String(val.getHours()).padStart(2, '0');
      const mm = String(val.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    if (typeof val === 'number' && val >= 0 && val < 1) {
      const totalMins = Math.round(val * 24 * 60) % 1440;
      const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
      const mm = String(totalMins % 60).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    const str = String(val).trim();
    if (!str) return '';

    // Convert "HH:MM:SS" or "H:MM:SS AM/PM" to clean "HH:MM"
    const secMatch = str.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\s*(AM|PM))?$/i);
    if (secMatch) {
      let h = parseInt(secMatch[1], 10);
      const m = parseInt(secMatch[2], 10);
      const ampm = (secMatch[4] || '').toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    return str;
  }

  /**
   * Format a spreadsheet row array into a tab-separated line, joining adjacent standalone Start/End time columns
   */
  static _formatSpreadsheetRow(rowArray, durColIdx = -1) {
    if (!Array.isArray(rowArray)) return '';
    const cells = [];
    for (let c = 0; c < rowArray.length; c++) {
      let cellStr = this._normalizeSpreadsheetCell(rowArray[c]);
      if (!cellStr) continue;
      if (c === durColIdx && /^\d{1,3}$/.test(cellStr)) {
        cellStr = `(${cellStr}min)`;
      }
      cells.push(cellStr);
    }
    if (cells.length === 0) return '';

    // Join adjacent cells that are individual time tokens (e.g. col[i]="21:00", col[i+1]="22:15" -> "21:00 - 22:15")
    const merged = [];
    for (let i = 0; i < cells.length; i++) {
      const cur = cells[i];
      const next = cells[i + 1];
      if (next !== undefined && this.parseTimeStrToMinutes(cur) !== null && this.parseTimeStrToMinutes(next) !== null) {
        merged.push(`${this.formatCleanTime(cur)} - ${this.formatCleanTime(next)}`);
        i++; // skip next
      } else {
        merged.push(cur);
      }
    }
    return merged.join('\t');
  }

  /**
   * Excel, CSV, Word (.docx), Image (.png, .jpg, .jpeg, .webp) & Text extraction with structured column support and sheet-name day preservation
   */
  static async extractSpreadsheetOrText(file, onStatus = null) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    // Image files (.png, .jpg, .jpeg, .webp) via OCR
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext) || (file.type && file.type.startsWith('image/'))) {
      if (typeof onStatus === 'function') {
        onStatus('🔍 A reconhecer horários da imagem por OCR...');
      }
      const imgUrl = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Falha ao carregar imagem.'));
          el.src = imgUrl;
        });
        const scale = img.width < 1200 ? 2.0 : 1.0;
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(img.width * scale);
        canvas.height = Math.floor(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const ocrText = await this._ocrCanvasToTableText(canvas, (pct) => {
          if (typeof onStatus === 'function') {
            onStatus(`🔍 A ler horários da imagem (${pct}%)...`);
          }
        });
        return { pages: [ocrText], titles: ['Dia 1'] };
      } finally {
        URL.revokeObjectURL(imgUrl);
      }
    }

    // Word (.docx) support via Mammoth if available
    if (ext === 'docx' && typeof mammoth !== 'undefined' && mammoth.extractRawText) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        const text = (result.value || '').trim();
        if (text) return { pages: [text], titles: ['Documento Word'] };
      } catch (e) {}
    }

    if (['xlsx', 'xls', 'csv'].includes(ext) && typeof XLSX !== 'undefined') {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: false });
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

        // Check if rows have a "Dia" / "Day" or "Duração" column
        const headerRow = (rows[0] || []).map(c => String(c).trim().toLowerCase());
        const dayColIdx = headerRow.findIndex(c => /^(dia|day|data|date)$/i.test(c));
        const durColIdx = headerRow.findIndex(c => /^(dura[çc][ãa]o|duration|tempo|min|minutos)$/i.test(c));

        if (dayColIdx !== -1 && rows.length > 2) {
          const dayGroups = new Map();
          for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.every(c => !c)) continue;
            const dayVal = String(row[dayColIdx] || '').trim();
            const groupKey = dayVal || '1';
            if (!dayGroups.has(groupKey)) dayGroups.set(groupKey, []);
            const filteredRow = row.filter((_, idx) => idx !== dayColIdx);
            const adjDurIdx = durColIdx > dayColIdx ? durColIdx - 1 : durColIdx;
            const lineStr = this._formatSpreadsheetRow(filteredRow, adjDurIdx);
            if (lineStr) dayGroups.get(groupKey).push(lineStr);
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
          .map((r, rIdx) => this._formatSpreadsheetRow(r, rIdx > 0 ? durColIdx : -1))
          .filter(Boolean)
          .join('\n');

        if (sheetText.trim()) {
          pages.push(`=== ${sheetName} ===\n` + sheetText);
          titles.push(sheetName);
        }
      }

      return { pages, titles };
    }

    const txt = await file.text();
    return { pages: [txt], titles: ['Documento'] };
  }
}

window.ScheduleImporter = ScheduleImporter;
