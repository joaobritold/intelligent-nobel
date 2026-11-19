/**
 * TheatreImporter — Universal File & Text Importer for Theatre Mode
 * Supports PDF, Excel (.xlsx, .xls, .csv), Word (.docx), and plain text for both Scripts and Cues.
 * Prepared for:
 *  - Full Technical Scripts with embedded cues (e.g. "CUE 0.5 - BO", inline cues after/mid dialogue, multiple cues per line)
 *  - Dedicated Cue Sheets / Tables (Excel, CSV, TSV, pipe/semicolon tables, Word/PDF tables)
 *  - Numbered / Bulleted Cue Lists
 *  - Pure Literary Scripts (preserving layout or structuring speakers/headings/directions)
 *  - Automatic Cross-Linking between Script lines and Cues (even when imported separately)
 */
class TheatreImporter {
  static VALID_DEPTS = ['Luz', 'Som', 'Maquinaria', 'Vídeo', 'Coxias'];

  static isDepartmentString(str) {
    if (!str) return false;
    const s = String(str).toLowerCase().trim();
    if (!s || s.length > 45) return false;
    return /\b(luz|light|ilum|som|sound|audio|áudio|maq|mach|cenar|cenár|vara|cortina|vid|v[ií]deo|proj|ecra|ecrã|tela|cox|ader|ator|palco|piro|fumo|laser|led|tod|geral|all)\b/i.test(s);
  }

  static normalizeDepartments(deptRaw, fallbackDepts = ['Luz']) {
    if (!deptRaw) return [...fallbackDepts];
    if (Array.isArray(deptRaw)) return deptRaw.length > 0 ? deptRaw : [...fallbackDepts];
    const str = String(deptRaw).toLowerCase();
    const matched = [];
    if (str.includes('luz') || str.includes('light') || str.includes('ilum')) matched.push('Luz');
    if (str.includes('som') || str.includes('sound') || str.includes('audio') || str.includes('áudio')) matched.push('Som');
    if (str.includes('maq') || str.includes('mach') || str.includes('cenar') || str.includes('cenár') || str.includes('vara') || str.includes('cortina') || str.includes('piro') || str.includes('explos')) matched.push('Maquinaria');
    if (str.includes('vid') || str.includes('vídeo') || str.includes('proj') || str.includes('ecra') || str.includes('ecrã') || str.includes('tela')) matched.push('Vídeo');
    if (str.includes('cox') || str.includes('ader') || str.includes('ator') || str.includes('palco')) matched.push('Coxias');
    if (str.includes('tod') || str.includes('geral') || str.includes('all')) return [...TheatreImporter.VALID_DEPTS];
    return matched.length > 0 ? matched : [...fallbackDepts];
  }

  /**
   * Infer departments from a cue's description/notes and document header context
   */
  static inferDepartmentsFromCueText(cueName = '', cueNotes = '', docBaseDepts = ['Luz']) {
    const combined = `${cueName} ${cueNotes}`.toLowerCase();
    const depts = new Set(docBaseDepts);

    if (/\b(luz|bo|blackout|flash|flah|follow|5k|pc|par|fresnel|recorte|pub|ribalta|contra|dimmer|strobe|foco)\b/i.test(combined)) {
      depts.add('Luz');
    }
    if (/\b(som|m[uú]sica|tiro|tiros|sirene|vozes|apito|piii+|micro|áudio|audio|ru[ií]do|efeito sonoro|final do som|som el[eé]trico)\b/i.test(combined)) {
      depts.add('Som');
    }
    if (/\b(v[ií]deo|video|proje[cç][aã]o|projetor|ecr[aã]|tela|led|clip)\b/i.test(combined)) {
      depts.add('Vídeo');
    }
    if (/\b(maquinaria|cortina|vara|pano|bambolina|rotunda|al[cç]ap[aã]o|explos[aã]o|explos[oõ]es|fumo|piro|pirotecnia)\b/i.test(combined)) {
      depts.add('Maquinaria');
    }

    return Array.from(depts);
  }

  /**
   * Detect base department from document title/header (e.g. "GUIÃO DE LUZ" -> ['Luz'], "GUIÃO DE SOM" -> ['Som'])
   */
  static detectDocumentBaseDepartments(rawText = '') {
    const headerSample = String(rawText || '').slice(0, 600).toLowerCase();
    if (/gui[aã]o\s+de\s+som|mapa\s+de\s+som|deixas\s+de\s+som/i.test(headerSample)) return ['Som'];
    if (/gui[aã]o\s+de\s+v[ií]deo|mapa\s+de\s+v[ií]deo/i.test(headerSample)) return ['Vídeo'];
    if (/gui[aã]o\s+de\s+maquinaria|mapa\s+de\s+maquinaria/i.test(headerSample)) return ['Maquinaria'];
    return ['Luz'];
  }

  /**
   * Format cue number consistently (e.g. "0.5" -> "Q0.5", "CUE 22.5" -> "Q22.5", "Q1" -> "Q1")
   */
  static formatCueNum(rawNum, fallbackIndex = 1) {
    if (!rawNum) return `Q${fallbackIndex}`;
    const cleaned = String(rawNum).trim()
      .replace(/^(?:cue|deixa|q)\s*[-#:]?\s*/i, '')
      .replace(',', '.');
    if (!cleaned) return `Q${fallbackIndex}`;
    if (/^\d/.test(cleaned)) return `Q${cleaned.toUpperCase()}`;
    return cleaned.toUpperCase();
  }

  /**
   * Normalize a cue number to its bare canonical key for matching (e.g. "Q0.5" -> "0.5", "CUE 22.5" -> "22.5")
   */
  static canonicalCueKey(rawNum) {
    return String(rawNum || '').trim()
      .replace(/^(?:cue|deixa|q)\s*[-#:]?\s*/i, '')
      .replace(',', '.')
      .toUpperCase();
  }

  /**
   * Automatically cross-link script items and cues (useful when script and cues are imported separately)
   */
  static autoLinkScriptAndCues(script = [], cues = []) {
    if (!Array.isArray(script) || !Array.isArray(cues) || script.length === 0 || cues.length === 0) {
      return script;
    }

    const cueById = new Map();
    const cueByKey = new Map();
    cues.forEach(c => {
      if (!c || !c.id) return;
      cueById.set(c.id, c);
      const key = TheatreImporter.canonicalCueKey(c.num);
      if (key && !cueByKey.has(key)) {
        cueByKey.set(key, c);
      }
    });

    script.forEach(item => {
      if (!item) return;
      // If already linked to a valid existing cue ID, keep it
      if (item.cueAnchor && cueById.has(item.cueAnchor)) return;

      // 1. Check if item.text or item.raw contains an explicit cue number like "Q6", "CUE 6", "DEIXA 6"
      const textToScan = `${item.text || ''} ${item.raw || ''}`;
      const match = textToScan.match(/\b(?:CUE|DEIXA|Q)\s*[-#:]?\s*(\d+(?:[.,]\d+)?[A-Za-z]?)\b/i);
      if (match) {
        const key = TheatreImporter.canonicalCueKey(match[1]);
        const matchedCue = cueByKey.get(key);
        if (matchedCue) {
          item.cueAnchor = matchedCue.id;
          return;
        }
      }
    });

    return script;
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
   * Helper: Check if a line is just a standalone page number (e.g. "1", "2", "17", "Página 3")
   */
  static _isStandalonePageNumber(line) {
    const trimmed = String(line || '').trim();
    return /^(?:p[aá]g(?:ina)?\.?\s*)?\d{1,3}$/i.test(trimmed);
  }

  /**
   * Split an extracted cue segment if an inline ALL-CAPS or quoted cue description
   * transitions back into lowercase actor dialogue on the same line.
   * Example 1: `“Prof.” fazer perguntas!` -> cueDesc: `“Prof.”`, trailingDialogue: `fazer perguntas!`
   * Example 2: `CRAVO DESCE O BANCO tenham medo de dirigir...` -> cueDesc: `CRAVO DESCE O BANCO`, trailingDialogue: `tenham medo de dirigir...`
   */
  static _splitInlineCueFromTrailingDialogue(rawCueSegment) {
    const seg = String(rawCueSegment || '').trim();
    if (!seg) return { cueDesc: '', trailingDialogue: '' };

    // Case A: Starts with a quoted trigger word/phrase followed by lowercase speech
    const quotedMatch = seg.match(/^([“"'][^”"']+[”"'])\s+([a-záàâãéêíóôõúç].*)$/);
    if (quotedMatch) {
      return {
        cueDesc: quotedMatch[1].trim(),
        trailingDialogue: quotedMatch[2].trim()
      };
    }

    // Case B: Starts with 2+ ALL-CAPS words/tokens followed by lowercase words (actor dialogue continuation)
    const capsThenLowerMatch = seg.match(/^([A-ZÀ-Ú0-9][A-ZÀ-Ú0-9\s\/\+,\.\(\)\-–—“”"':]{3,}?)\s+([a-záàâãéêíóôõúç]{2,}(?:[\s,.;!?].*|$))$/);
    if (capsThenLowerMatch) {
      const candidateCaps = capsThenLowerMatch[1].trim();
      // Ensure candidateCaps has no lowercase letters and has at least 2 uppercase words
      if (candidateCaps === candidateCaps.toUpperCase() && /[A-ZÀ-Ú]{2,}\s+[A-ZÀ-Ú0-9]{2,}/.test(candidateCaps)) {
        return {
          cueDesc: candidateCaps,
          trailingDialogue: capsThenLowerMatch[2].trim()
        };
      }
    }

    return { cueDesc: seg, trailingDialogue: '' };
  }

  /**
   * Extract all explicit CUE / DEIXA / Q markers from a single line of text.
   * Returns { cues: Array<{ rawNum, num, name, notes, inlineTarget }>, dialogueOnly: string }
   */
  static extractExplicitCuesFromLine(line, docBaseDepts = ['Luz']) {
    const rawLine = String(line || '').trim();
    if (!rawLine) return { cues: [], dialogueOnly: '' };

    // Match explicit cue markers:
    // - "CUE 0.5 - BO", "CUE 1 – LUZ PUB", "CUE 22.5 – 2 TIROS", "DEIXA 3: ...", "[CUE 4 - ...]"
    // - "Q1 - ...", "Q12.5: ..." when at start of line, after tab/bracket, or followed by separator
    const cueRegex = /(?:^|[\s\t\[\(])(?:(CUE|DEIXA)\s*(\d+(?:[.,]\d+)?[A-Za-z]?)|(Q)\s*(\d+(?:[.,]\d+)?[A-Za-z]?)(?=\s*[:\-–—\t|;]))\s*(?:[:\-–—]+\s*|\t+\s*|\s+)/gi;

    const matches = [];
    let m;
    while ((m = cueRegex.exec(rawLine)) !== null) {
      const fullMatch = m[0];
      const tokenMatch = fullMatch.match(/(CUE|DEIXA|Q)\s*\d+/i);
      const tokenOffset = tokenMatch ? fullMatch.indexOf(tokenMatch[0]) : 0;
      const cueStartIdx = m.index + tokenOffset;
      const contentStartIdx = m.index + fullMatch.length;
      const rawNum = m[2] || m[4];

      matches.push({
        cueStartIdx,
        contentStartIdx,
        rawNum
      });
    }

    if (matches.length === 0) {
      // Also check for standalone cue without description (e.g. "CUE 10" or "[CUE 10]")
      const bareMatch = rawLine.match(/^\[\s*(?:CUE|DEIXA|Q)\s*(\d+(?:[.,]\d+)?[A-Za-z]?)\s*\]$|^(?:CUE|DEIXA)\s*(\d+(?:[.,]\d+)?[A-Za-z]?)$/i);
      if (bareMatch) {
        const numStr = TheatreImporter.formatCueNum(bareMatch[1] || bareMatch[2]);
        return {
          cues: [{
            num: numStr,
            name: `Deixa ${numStr}`,
            notes: '',
            inlineTarget: '',
            departments: [...docBaseDepts]
          }],
          dialogueOnly: ''
        };
      }
      return { cues: [], dialogueOnly: rawLine };
    }

    const prefixDialogue = rawLine.slice(0, matches[0].cueStartIdx).replace(/[\t\[\(]+$/, '').trim();
    const dialogueParts = [];
    if (prefixDialogue) dialogueParts.push(prefixDialogue);

    const extractedCues = [];

    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const nextStart = (i + 1 < matches.length) ? matches[i + 1].cueStartIdx : rawLine.length;
      let rawSegment = rawLine.slice(cur.contentStartIdx, nextStart).replace(/[\]\)]+$/, '').trim();

      const { cueDesc, trailingDialogue } = TheatreImporter._splitInlineCueFromTrailingDialogue(rawSegment);
      if (trailingDialogue) {
        dialogueParts.push(trailingDialogue);
      }

      // Check if cueDesc has tab-separated right-margin annotations (from PDF layout gaps)
      let namePart = cueDesc;
      let notesPart = '';
      if (cueDesc.includes('\t')) {
        const tabCols = cueDesc.split(/\t+/).map(s => s.trim()).filter(Boolean);
        namePart = tabCols[0] || '';
        const extraCols = tabCols.slice(1).join(' • ');
        // If extra column is a short parenthetical like "(5K SOBE)", keep it in the name; otherwise put in notes
        if (extraCols.startsWith('(') && extraCols.endsWith(')') && extraCols.length <= 24) {
          namePart = `${namePart} ${extraCols}`.trim();
        } else {
          notesPart = extraCols;
        }
      }

      const num = TheatreImporter.formatCueNum(cur.rawNum);
      let finalName = namePart || `Deixa ${num}`;
      let quotedWordTrigger = '';

      // If the cue name is purely a quoted trigger word/phrase (e.g. “ESTÁ”, “Meus Se.”, “Prof.”, “EU OUVI”), label it clearly
      if (/^[“"'][^”"']+[”"']$/.test(finalName)) {
        quotedWordTrigger = `Na palavra ${finalName}`;
        finalName = `Deixa na fala ${finalName}`;
      }

      const departments = TheatreImporter.inferDepartmentsFromCueText(finalName, notesPart, docBaseDepts);

      extractedCues.push({
        num,
        name: finalName,
        notes: notesPart,
        quotedWordTrigger,
        inlineTarget: '', // filled below once full line dialogue is assembled
        departments
      });
    }

    const dialogueOnly = dialogueParts.join(' ').replace(/\s{2,}/g, ' ').trim();
    extractedCues.forEach(c => {
      if (c.quotedWordTrigger && dialogueOnly) {
        c.inlineTarget = `${c.quotedWordTrigger} — ${dialogueOnly}`;
      } else if (c.quotedWordTrigger) {
        c.inlineTarget = c.quotedWordTrigger;
      } else if (dialogueOnly) {
        c.inlineTarget = dialogueOnly;
      }
    });

    return {
      cues: extractedCues,
      dialogueOnly
    };
  }

  /**
   * Parse speaker and speech from a theatre dialogue line.
   * Supports:
   *  - "ATOR 1: Estamos a postos."
   *  - "O HOMEM DAS SA Exercícios nocturnos!" (ALL-CAPS character prefix followed by mixed-case dialogue)
   *  - "B - Afasta-te de Lohmann..." / "SA – Estavam aqui a falar."
   */
  static _parseDialogueSpeaker(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return { speaker: '', text: '' };

    // 1. Explicit colon "SPEAKER: speech"
    const colonMatch = trimmed.match(/^([A-ZÀ-Ú0-9][A-ZÀ-Ú0-9\s\.\-]{0,28}?)(?:\s+de\s+cor|\s+ao\s+telefone|\s+com\s+[^:]{1,25})?:\s+(.+)$/i);
    if (colonMatch) {
      const candidate = colonMatch[1].trim();
      if (candidate === candidate.toUpperCase() || candidate.split(/\s+/).length <= 4) {
        return {
          speaker: candidate.toUpperCase(),
          text: colonMatch[2].trim()
        };
      }
    }

    // 2. Short uppercase initial/code with dash: "B - Afasta-te...", "SA – Estavam aqui..."
    const dashSpeakerMatch = trimmed.match(/^([A-ZÀ-Ú]{1,4})\s+[-–—]\s+([A-ZÀ-Ú“"']?[a-záàâãéêíóôõúç].*)$/);
    if (dashSpeakerMatch) {
      return {
        speaker: dashSpeakerMatch[1].trim(),
        text: dashSpeakerMatch[2].trim()
      };
    }

    // 3. ALL-CAPS character name at start of line followed by normal mixed-case sentence
    const tokens = trimmed.replace(/\t+/g, ' ').split(/\s+/);
    if (tokens.length >= 2) {
      const upperWords = [];
      let speechStartIdx = -1;

      for (let i = 0; i < Math.min(tokens.length, 6); i++) {
        const tok = tokens[i];
        const cleanTok = tok.replace(/[,.:;!?]+$/, '');
        const isAllCapsWord = /^[A-ZÀ-ÚЄІЇ]+$/.test(cleanTok) && (
          cleanTok.length >= 2 ||
          ['O', 'A', 'E', 'X', 'Y', 'B', 'D', 'L'].includes(cleanTok)
        );

        if (isAllCapsWord) {
          upperWords.push(tok);
        } else {
          speechStartIdx = i;
          break;
        }
      }

      if (speechStartIdx > 0 && upperWords.length >= 1) {
        const nextTok = tokens[speechStartIdx] || '';
        while (upperWords.length > 1 && /^(É|À|Ó)$/.test(upperWords[upperWords.length - 1])) {
          upperWords.pop();
          speechStartIdx--;
        }
        if (upperWords.length > 1 && /^(O|A|OS|AS|UM|UMA|DE|DO|DA)$/.test(upperWords[upperWords.length - 1]) && /^[a-záàâãéêíóôõúç]/.test(nextTok)) {
          upperWords.pop();
          speechStartIdx--;
        }

        const candidateSpeaker = upperWords.join(' ').replace(/[:\-–—]+$/, '').trim();
        const remainingSpeech = tokens.slice(speechStartIdx).join(' ').trim();

        const isValidSpeaker = (
          candidateSpeaker.length >= 1 &&
          candidateSpeaker.length <= 28 &&
          remainingSpeech.length >= 2 &&
          !/^(CUE|DEIXA|ATO|ACTO|CENA|QUADRO)\b/i.test(candidateSpeaker) &&
          (
            /^(O|A|OS|AS)\s+[A-ZÀ-Ú]{2,}/.test(candidateSpeaker) ||
            /^(HOMEM|MULHER|CRIADA|COZINHEIRA|TRABALHADOR|TRABALHADORA|MOTORISTA|LOCUTOR|CIRURGIÃO|VIZINHA|MARIDO|FILHA|MÃE|RAPAZ|OPERÁRIA|OPERÁRIO|SENHOR|DOUTOR|VOZ|CORO)\b/.test(candidateSpeaker) ||
            /^[XYBDL]$|^SA$/.test(candidateSpeaker)
          )
        );

        if (isValidSpeaker) {
          return {
            speaker: candidateSpeaker,
            text: remainingSpeech
          };
        }
      }
    }

    return { speaker: '', text: trimmed };
  }

  /**
   * Parse Pure Script Text without touching formatting, case or spacing
   */
  static parsePureScriptText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];
    const rawLines = rawText.split(/\r?\n/);
    const script = [];
    rawLines.forEach((rawLine, idx) => {
      const trimmed = rawLine.trim();
      if (TheatreImporter._isStandalonePageNumber(trimmed)) return;

      if (!trimmed) {
        script.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'blank',
          speaker: '',
          text: '',
          raw: rawLine,
          cueAnchor: null
        });
        return;
      }

      if (/^(acto|ato|cena|quadro|pr[oó]logo|ep[ií]logo|parte)\b/i.test(trimmed)) {
        script.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'heading',
          speaker: '',
          text: trimmed,
          raw: rawLine,
          cueAnchor: null
        });
        return;
      }

      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('(') && trimmed.endsWith(')'))) {
        script.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'direction',
          speaker: '',
          text: trimmed,
          raw: rawLine,
          cueAnchor: null
        });
        return;
      }

      script.push({
        id: 'sc_' + Date.now() + '_' + idx,
        type: 'dialogue',
        speaker: '',
        text: trimmed,
        raw: rawLine,
        cueAnchor: null
      });
    });
    return script;
  }

  /**
   * Helper: Try to parse a single line as a structured Delimited Table Row
   * (e.g. "Q1; Abertura de Sala; Luz,Som; 3º Sinal; Sala a 80%" or "1 | Blackout | Luz | Fim | Fade")
   * Returns a cue object or null if the line is not a delimited table row.
   */
  static _tryParseDelimitedCueRow(line, idx, baseTs, docBaseDepts = ['Luz']) {
    if (!line || (!line.includes('|') && !line.includes(';') && !line.includes('\t'))) {
      return null;
    }

    // Distinguish real table delimiters (; or |, or \t when column 0 is strictly a bare Cue ID)
    const isCueIdToken = (str) => /^(?:(?:cue|deixa|q)\s*[-#:]?\s*)?\d+(?:[.,]\d+)?[A-Za-z]?$/i.test(String(str || '').trim());
    const parts = line.split(/[\t|;]/).map(p => p.trim());
    if (parts.length < 2 || !isCueIdToken(parts[0]) || !parts[1]) {
      return null;
    }

    // If parts[1] contains another explicit "CUE X" marker, it's a multi-cue script line, not a table row
    if (/\b(?:CUE|DEIXA)\s*\d+/i.test(parts[1])) {
      return null;
    }

    const num = TheatreImporter.formatCueNum(parts[0], idx + 1);
    const name = parts[1] || `Deixa ${num}`;
    let deptRaw = '';
    let target = '';
    let notes = '';

    if (parts.length >= 3) {
      if (TheatreImporter.isDepartmentString(parts[2])) {
        deptRaw = parts[2];
        target = parts[3] || '';
        notes = parts[4] || '';
      } else {
        target = parts[2] || '';
        notes = parts[3] || '';
      }
    }

    const departments = deptRaw
      ? TheatreImporter.normalizeDepartments(deptRaw, docBaseDepts)
      : TheatreImporter.inferDepartmentsFromCueText(name, notes, docBaseDepts);

    return {
      id: `cue_${baseTs}_${idx}_${Math.random().toString(36).substr(2, 3)}`,
      num,
      name,
      departments,
      targetText: target,
      notes,
      status: 'pending',
      standbyAt: 0,
      firedAt: 0,
      firedTimecode: '',
      feedbacks: []
    };
  }

  /**
   * Parse a full Technical Script with embedded Cues (or hybrid table/script), returning BOTH:
   *  - script: Array of script items (with cueAnchor linked to the cue ID)
   *  - cues: Array of extracted cue objects
   */
  static parseScriptWithCues(rawText) {
    if (!rawText || typeof rawText !== 'string') return { script: [], cues: [] };

    const docBaseDepts = TheatreImporter.detectDocumentBaseDepartments(rawText);
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const script = [];
    const cues = [];
    const baseTs = Date.now();

    let lastContextTrigger = '';
    let currentSceneHeading = '';

    lines.forEach((line, idx) => {
      // Skip standalone page numbers (e.g. "1", "2", ... "17") or table headers
      if (TheatreImporter._isStandalonePageNumber(line)) return;
      if (/^(deixa|cue|q|q#|num|n[oº°]|id)\s*(\||;|\t)/i.test(line)) return;

      // 0. Check if line is a Delimited Table Row (e.g. "Q1; Abertura; Luz,Som; 3º Sinal; Notas")
      const tableCue = TheatreImporter._tryParseDelimitedCueRow(line, idx, baseTs, docBaseDepts);
      if (tableCue) {
        cues.push(tableCue);
        script.push({
          id: `sc_${baseTs}_${idx}`,
          type: 'direction',
          speaker: '',
          text: `${tableCue.num} — ${tableCue.name}${tableCue.targetText ? ' [' + tableCue.targetText + ']' : ''}`,
          cueAnchor: tableCue.id
        });
        return;
      }

      // 1. Extract any explicit cues on this line (e.g. "CUE 0.5 - BO", "O SEGUNDO Sã'eles! CUE 6 – FLASH...", multiple cues)
      const { cues: lineCues, dialogueOnly } = TheatreImporter.extractExplicitCuesFromLine(line, docBaseDepts);

      const createdCueIds = [];
      if (lineCues.length > 0) {
        lineCues.forEach((lc, cIdx) => {
          const cueId = `cue_${baseTs}_${idx}_${cIdx}_${Math.random().toString(36).substr(2, 3)}`;
          createdCueIds.push(cueId);

          // Determine best trigger/targetText for this cue
          let targetText = lc.inlineTarget || '';
          if (!targetText) {
            if (lastContextTrigger) {
              targetText = lastContextTrigger;
            } else if (currentSceneHeading) {
              targetText = `Cena: ${currentSceneHeading}`;
            }
          } else if (lc.quotedWordTrigger && !dialogueOnly && lastContextTrigger) {
            targetText = `${lc.quotedWordTrigger} — ${lastContextTrigger}`;
          }

          if (targetText.length > 110) {
            targetText = targetText.slice(0, 107) + '...';
          }

          cues.push({
            id: cueId,
            num: lc.num,
            name: lc.name,
            departments: lc.departments,
            targetText: targetText,
            notes: lc.notes || '',
            status: 'pending',
            standbyAt: 0,
            firedAt: 0,
            firedTimecode: '',
            feedbacks: []
          });
        });
      }

      // If the line was ONLY cue(s) (no actor dialogue on the same line), add a technical direction line in the script anchored to the cue
      if (lineCues.length > 0 && !dialogueOnly) {
        lineCues.forEach((lc, cIdx) => {
          const cId = createdCueIds[cIdx];
          script.push({
            id: `sc_${baseTs}_${idx}_${cIdx}`,
            type: 'direction',
            speaker: '',
            text: `${lc.num} — ${lc.name}${lc.notes ? ' (' + lc.notes + ')' : ''}`,
            cueAnchor: cId
          });
        });
        return;
      }

      const effectiveLine = dialogueOnly || line;
      const primaryCueAnchor = createdCueIds[0] || null;

      // 2. Explicit Heading (ACTO, CENA, QUADRO, or short ALL-CAPS scene title like "A COMUNIDADE DO POVO", "LILI MARLENE", "ENTRADA")
      const isShortAllCapsHeading = (
        effectiveLine.length >= 3 &&
        effectiveLine.length <= 55 &&
        effectiveLine === effectiveLine.toUpperCase() &&
        /[A-ZÀ-Ú]{3,}/.test(effectiveLine) &&
        !/^(SIM|NÃO|OK|HEIL HITLER!?)$/.test(effectiveLine)
      );

      if (/^(acto|ato|cena|quadro|pr[oó]logo|ep[ií]logo|parte)\b/i.test(effectiveLine) || isShortAllCapsHeading) {
        currentSceneHeading = effectiveLine;
        lastContextTrigger = `Cena: ${effectiveLine}`;
        script.push({
          id: `sc_${baseTs}_${idx}`,
          type: 'heading',
          speaker: '',
          text: effectiveLine,
          cueAnchor: primaryCueAnchor
        });
        return;
      }

      // 3. Stage Direction ([rubrica...] ou (didascália...))
      if ((effectiveLine.startsWith('[') && effectiveLine.endsWith(']')) || (effectiveLine.startsWith('(') && effectiveLine.endsWith(')'))) {
        const cleanDir = effectiveLine.replace(/^[\[\(]/, '').replace(/[\]\)]$/, '').trim();
        lastContextTrigger = `[${cleanDir}]`;
        script.push({
          id: `sc_${baseTs}_${idx}`,
          type: 'direction',
          speaker: '',
          text: cleanDir,
          cueAnchor: primaryCueAnchor
        });
        return;
      }

      // 4. Dialogue (with colon, dash, or ALL-CAPS character prefix)
      const { speaker, text } = TheatreImporter._parseDialogueSpeaker(effectiveLine);
      lastContextTrigger = speaker ? `${speaker}: ${text}` : text;

      script.push({
        id: `sc_${baseTs}_${idx}`,
        type: 'dialogue',
        speaker: speaker,
        text: text,
        cueAnchor: primaryCueAnchor
      });

      // If there were additional cues on the same dialogue line, append their anchor lines right below
      if (createdCueIds.length > 1) {
        for (let cIdx = 1; cIdx < createdCueIds.length; cIdx++) {
          const lc = lineCues[cIdx];
          script.push({
            id: `sc_${baseTs}_${idx}_extra_${cIdx}`,
            type: 'direction',
            speaker: '',
            text: `${lc.num} — ${lc.name}${lc.notes ? ' (' + lc.notes + ')' : ''}`,
            cueAnchor: createdCueIds[cIdx]
          });
        }
      }
    });

    return { script, cues };
  }

  /**
   * Parse text into structured Script items (Dialogue, Direction, Heading)
   */
  static parseScriptText(rawText) {
    return TheatreImporter.parseScriptWithCues(rawText).script;
  }

  /**
   * Parse Cues from File (handles Excel column headers, PDF/Word cue tables, or full scripts with embedded cues)
   */
  static async parseCuesFromFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    // If Excel / CSV, try structured table columns first
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

    // Otherwise extract text and parse intelligently (supports both Cue Sheets and Full Scripts with embedded cues)
    const text = await TheatreImporter.extractTextFromFile(file);
    return TheatreImporter.parseCuesFromText(text);
  }

  static _parseCuesFromTableRows(rows) {
    if (!rows || rows.length < 1) return [];

    const nonEmptyRows = rows.filter(r => Array.isArray(r) && r.some(c => String(c || '').trim() !== ''));
    if (nonEmptyRows.length === 0) return [];

    // Check if the spreadsheet is actually a 1-column text script rather than a multi-column table
    const multiColCount = nonEmptyRows.filter(r => r.filter(c => String(c || '').trim() !== '').length >= 2).length;
    if (multiColCount === 0) {
      const joinedText = nonEmptyRows.map(r => r.map(c => String(c || '').trim()).filter(Boolean).join(' ')).join('\n');
      return TheatreImporter.parseCuesFromText(joinedText);
    }

    // Find header row (check first 5 rows in case row 0 is a title like "MAPA DE LUZ - EDELWEISS")
    let headerRowIdx = -1;
    let idxNum = -1, idxName = -1, idxDept = -1, idxTarget = -1, idxNotes = -1;

    for (let rIdx = 0; rIdx < Math.min(5, nonEmptyRows.length); rIdx++) {
      const candidateHeaders = nonEmptyRows[rIdx].map(h => String(h || '').toLowerCase().trim());
      const cNum = candidateHeaders.findIndex(h => /^(q|q#|cue|cue\s*#|num|n[oº°]|deixa|n[uú]mero|id|#)$/i.test(h));
      const cName = candidateHeaders.findIndex(h => /^(nome|name|a[cç][aã]o|efeito|t[ií]tulo|title|descri[cç][aã]o|o\s*qu[eê])$/i.test(h));
      const cDept = candidateHeaders.findIndex(h => /^(dept|depts|departamento|departamentos|equipa|equipas|setor|t[eé]cnica)$/i.test(h));
      const cTarget = candidateHeaders.findIndex(h => /^(gatilho|fala|ponto|target|momento|trigger|deixa\s*de\s*texto|onde|quando)$/i.test(h));
      const cNotes = candidateHeaders.findIndex(h => /^(nota|notas|obs|observa[cç][oõ]es|notes|tempo|fade|dura[cç][aã]o)$/i.test(h));

      if (cNum !== -1 || cName !== -1 || (cDept !== -1 && cTarget !== -1)) {
        headerRowIdx = rIdx;
        idxNum = cNum;
        idxName = cName;
        idxDept = cDept;
        idxTarget = cTarget;
        idxNotes = cNotes;
        break;
      }
    }

    const hasHeaders = headerRowIdx !== -1;
    const startRow = hasHeaders ? headerRowIdx + 1 : 0;
    const cues = [];

    for (let i = startRow; i < nonEmptyRows.length; i++) {
      const row = nonEmptyRows[i];
      const cleanCells = row.map(c => String(c || '').trim());
      if (cleanCells.every(c => !c)) continue;

      let num = hasHeaders && idxNum !== -1 ? cleanCells[idxNum] : cleanCells[0];
      let name = hasHeaders && idxName !== -1 ? cleanCells[idxName] : cleanCells[1];
      let dept = hasHeaders && idxDept !== -1 ? cleanCells[idxDept] : cleanCells[2];
      let target = hasHeaders && idxTarget !== -1 ? cleanCells[idxTarget] : cleanCells[3];
      let notes = hasHeaders && idxNotes !== -1 ? cleanCells[idxNotes] : cleanCells[4];

      // Skip repeated header rows
      if (/^(q|cue|deixa|num|n[oº°]|#)$/i.test(num) && /^(nome|name|a[cç][aã]o|descri[cç][aã]o)$/i.test(name)) {
        continue;
      }

      // If no headers and cell 0 is NOT a valid cue ID, check if the row contains an embedded CUE X
      if (!hasHeaders && num && !/^(?:(?:cue|deixa|q)\s*[-#:]?\s*)?\d+(?:[.,]\d+)?[A-Za-z]?$/i.test(num)) {
        const rowLine = cleanCells.filter(Boolean).join('\t');
        const { cues: inlineCues } = TheatreImporter.extractExplicitCuesFromLine(rowLine);
        if (inlineCues.length > 0) {
          inlineCues.forEach((ic, cIdx) => {
            cues.push({
              id: `cue_${Date.now()}_${i}_${cIdx}_${Math.random().toString(36).substr(2, 3)}`,
              num: ic.num,
              name: ic.name,
              departments: ic.departments,
              targetText: ic.inlineTarget || '',
              notes: ic.notes || '',
              status: 'pending',
              standbyAt: 0,
              firedAt: 0,
              firedTimecode: '',
              feedbacks: []
            });
          });
        }
        continue;
      }

      if (!num && !name) continue;
      const formattedNum = TheatreImporter.formatCueNum(num, cues.length + 1);
      const finalName = name || `Deixa ${formattedNum}`;

      let departments;
      if (hasHeaders && idxDept !== -1 && dept) {
        departments = TheatreImporter.normalizeDepartments(dept);
      } else if (!hasHeaders && dept && TheatreImporter.isDepartmentString(dept)) {
        departments = TheatreImporter.normalizeDepartments(dept);
      } else {
        if (!hasHeaders && dept && !target) {
          target = dept;
        }
        departments = TheatreImporter.inferDepartmentsFromCueText(finalName, notes);
      }

      cues.push({
        id: 'cue_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 3),
        num: formattedNum,
        name: finalName,
        departments,
        targetText: target || '',
        notes: notes || '',
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
   * Universal Cue Parser from plain text / PDF text / Word text / pasted string.
   * Automatically adapts to:
   *  1. Full Scripts with embedded cues ("CUE 0.5 - BO", "O SEGUNDO Sã'eles! CUE 6 – FLASH...", multiple cues per line)
   *  2. Delimited Cue Tables ("Q1; Abertura de Sala; Luz, Som; 3º Sinal; Notas" or TSV/Pipe tables)
   *  3. Numbered Cue Lists ("1 - Abertura de Sala", "Q2: Blackout [Luz, Som] - Gatilho (Notas)")
   *  4. Simple manual pasted lists
   */
  static parseCuesFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    // First, run the unified Script + Table + Explicit Cue parser
    const { cues: structuredCues } = TheatreImporter.parseScriptWithCues(rawText);
    if (structuredCues.length > 0) {
      return structuredCues;
    }

    // Fallback for documents without explicit "CUE"/"DEIXA"/"Q" keywords or delimited table columns
    // (e.g. numbered lists "1 - Luz de Sala", "2.5 - Blackout" or short manual lists)
    const docBaseDepts = TheatreImporter.detectDocumentBaseDepartments(rawText);
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const cues = [];
    const baseTs = Date.now();

    lines.forEach((line, idx) => {
      if (TheatreImporter._isStandalonePageNumber(line)) return;
      if (/^(deixa|cue|q|q#|num|n[oº°]|id)\s*(\||;|\t|:)/i.test(line)) return;

      // Format "1: Nome [Luz, Som] - Gatilho (Notas)" or "1.5 - Blackout"
      const numberedMatch = line.match(/^(\d+(?:[.,]\d+)?[A-Za-z]?)\s*[:\-–—]\s*([^\[\(\-]+)(?:\[(.*?)\])?(?:\s*[-–—]\s*([^\(\)]+))?(?:\s*\((.*?)\))?$/i);
      if (numberedMatch) {
        const num = TheatreImporter.formatCueNum(numberedMatch[1], cues.length + 1);
        const name = numberedMatch[2].trim();
        const deptRaw = numberedMatch[3] || '';
        const target = numberedMatch[4] ? numberedMatch[4].trim() : '';
        const notes = numberedMatch[5] ? numberedMatch[5].trim() : '';
        const departments = deptRaw
          ? TheatreImporter.normalizeDepartments(deptRaw, docBaseDepts)
          : TheatreImporter.inferDepartmentsFromCueText(name, notes, docBaseDepts);

        cues.push({
          id: `cue_${baseTs}_${idx}_${Math.random().toString(36).substr(2, 3)}`,
          num,
          name,
          departments,
          targetText: target,
          notes,
          status: 'pending',
          standbyAt: 0,
          firedAt: 0,
          firedTimecode: '',
          feedbacks: []
        });
        return;
      }

      // Short manual list fallback (only if document is short, <= 80 lines)
      if (lines.length <= 80 && line.length <= 120) {
        const num = `Q${cues.length + 1}`;
        cues.push({
          id: `cue_${baseTs}_${idx}_${Math.random().toString(36).substr(2, 3)}`,
          num,
          name: line,
          departments: TheatreImporter.inferDepartmentsFromCueText(line, '', docBaseDepts),
          targetText: '',
          notes: '',
          status: 'pending',
          standbyAt: 0,
          firedAt: 0,
          firedTimecode: '',
          feedbacks: []
        });
      }
    });

    return cues;
  }
}

if (typeof window !== 'undefined') {
  window.TheatreImporter = TheatreImporter;
}
