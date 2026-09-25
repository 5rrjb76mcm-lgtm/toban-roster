# JS ソースの簡易走査。app-*.js の相互参照を検査する（build.py --check）ために、
# 文字列・コメント・正規表現・テンプレート文字列の中を飛ばしてコード部分の識別子だけを拾う。
# 構文解析器ではないので、この用途（識別子の列挙と、直前が '.' か・直後が ':' か）にだけ使う。
import re

IDENT = re.compile(r"[A-Za-z_$][\w$]*")
KEYWORDS_BEFORE_REGEX = {"return", "typeof", "case", "do", "else", "in", "of", "instanceof", "new", "delete", "void", "throw", "await", "yield"}
REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^")
DECL = re.compile(r"^  (?:async )?(function|const|let) ", re.M)


def scan(text):
    """(tokens, mask) を返す。tokens はコード部分の識別子 (name, start, end, prev, next)。
    prev / next はその前後の空白でない文字（無ければ ''）。'...' による展開は prev を '…' にして '.'（プロパティ参照）と区別する。
    mask[i] は text[i] がコード（文字列・コメント・正規表現・テンプレート文字列の地の文でない）なら 1。"""
    out = []
    n = len(text)
    mask = bytearray(n)
    i = 0
    stack = [["code", 0]]  # ["code", 波括弧の深さ] または ["tmpl"]
    last_sig = ""  # 直前の意味のある文字（正規表現か除算かの判定用）
    last_ident = ""
    while i < n:
        ctx = stack[-1]
        if ctx[0] == "tmpl":
            c = text[i]
            if c == "\\":
                i += 2
            elif c == "`":
                stack.pop(); mask[i] = 1; i += 1; last_sig = "`"; last_ident = ""
            elif text.startswith("${", i):
                stack.append(["code", 0]); mask[i] = mask[i + 1] = 1; i += 2; last_sig = "{"; last_ident = ""
            else:
                i += 1
            continue
        c = text[i]
        if c in " \t\r\n":
            mask[i] = 1; i += 1; continue
        if text.startswith("//", i):
            j = text.find("\n", i); i = n if j < 0 else j; continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        if c in "\"'":
            j = i + 1
            while j < n and text[j] != c:
                if text[j] == "\\":
                    j += 1
                j += 1
            i = j + 1; last_sig = c; last_ident = ""; continue
        if c == "`":
            stack.append(["tmpl"]); mask[i] = 1; i += 1; last_sig = "`"; last_ident = ""; continue
        if c == "/":
            if last_sig == "" or last_sig in REGEX_AFTER or last_ident in KEYWORDS_BEFORE_REGEX:
                j = i + 1; in_class = False
                while j < n:
                    ch = text[j]
                    if ch == "\\":
                        j += 2; continue
                    if in_class:
                        if ch == "]":
                            in_class = False
                    elif ch == "[":
                        in_class = True
                    elif ch == "/" or ch == "\n":
                        break
                    j += 1
                j += 1
                while j < n and text[j].isalpha():
                    j += 1
                i = j; last_sig = "/"; last_ident = ""; continue
            mask[i] = 1; i += 1; last_sig = "/"; last_ident = ""; continue
        m = IDENT.match(text, i)
        if m:
            name = m.group(0)
            k = i - 1
            while k >= 0 and text[k] in " \t\r\n":
                k -= 1
            prev = text[k] if k >= 0 else ""
            if prev == "." and k >= 2 and text[k - 2:k + 1] == "...":
                prev = "…"
            k2 = m.end()
            while k2 < n and text[k2] in " \t\r\n":
                k2 += 1
            nxt = text[k2] if k2 < n else ""
            out.append((name, i, m.end(), prev, nxt))
            for p in range(i, m.end()):
                mask[p] = 1
            i = m.end(); last_sig = "a"; last_ident = name
            continue
        if c == "{":
            ctx[1] += 1
        elif c == "}":
            if ctx[1] > 0:
                ctx[1] -= 1
            elif len(stack) > 1:
                stack.pop(); mask[i] = 1; i += 1; last_sig = "}"; last_ident = ""; continue
        mask[i] = 1; i += 1; last_sig = c; last_ident = ""
    return out, mask


def identifiers(text):
    return scan(text)[0]


def declared(text):
    """IIFE 直下（2字下げ）で宣言された名前。function は1つ、const / let は同じ行の深さ0の宣言子（`const a = 1, b = 2;` の b も）を拾う"""
    toks, mask = scan(text)
    names = []
    for m in DECL.finditer(text):
        if not mask[m.start() + 2]:
            continue  # テンプレート文字列などの中
        start = m.end()
        line_end = text.find("\n", start)
        line_end = len(text) if line_end < 0 else line_end
        line_toks = [t for t in toks if start <= t[1] < line_end]
        if not line_toks:
            continue
        names.append(line_toks[0][0])
        if m.group(1) == "function":
            continue
        depth, d_at = 0, {}
        for i in range(start, line_end):
            if mask[i]:
                d_at[i] = depth
                if text[i] in "([{":
                    depth += 1
                elif text[i] in ")]}":
                    depth -= 1
        for t in line_toks[1:]:
            if d_at.get(t[1], 1) == 0 and t[3] == "," and t[4] == "=":
                names.append(t[0])
    return names
