"""RADIOHUB — syntax. Role map:
  rust      keywords, control flow, storage, modifiers, attributes/decorators
  verdigris types, classes, interfaces, structs, enums, generics
  ochre     functions, methods, constructors
  moss      strings
  blueprint numbers, constants, enum members, booleans, null
  fg        variables, properties, fields
  mute      punctuation, operators
  graphite  comments
"""
from palette import alpha, mix

I, B, BI, U, N = "italic", "bold", "italic bold", "underline", ""

def semantic(P):
    rust, ochre, verd, blue, moss = P["rust"], P["ochre"], P["verdigris"], P["blueprint"], P["moss"]
    fg, mute, graphite, madder = P["fg"], P["mute"], P["graphite"], P["madder"]
    vh, rh = P["verd_hi"], P["rust_hi"]
    c = lambda col, st=None: ({"foreground": col} | ({"fontStyle": st} if st is not None else {}))
    return {
      # ── declarations & types ──────────────────────────────────────────
      "namespace": c(mute), "namespace.declaration": c(P["mute"], N),
      "module": c(mute),
      "class": c(verd), "class.declaration": c(verd, B),
      "class.defaultLibrary": c(vh),
      "struct": c(verd), "struct.declaration": c(verd, B),
      "recordClass": c(verd), "recordStruct": c(verd),
      "interface": c(vh), "interface.declaration": c(vh, B),
      "enum": c(verd), "enum.declaration": c(verd, B),
      "delegate": c(vh, I),
      "type": c(verd), "type.declaration": c(verd, B),
      "type.defaultLibrary": c(vh),
      "typeParameter": c(vh, I),
      "typeAlias": c(verd),
      "typeAlias.declaration": c(verd, B),

      # ── callables ─────────────────────────────────────────────────────
      "function": c(ochre), "function.declaration": c(ochre, B),
      "function.defaultLibrary": c(ochre),
      "function.async": c(ochre, I),
      "method": c(ochre), "method.declaration": c(ochre, B),
      "method.static": c(ochre, I),
      "method.async": c(ochre, I),
      "member": c(ochre), "member.declaration": c(ochre, B),
      "extensionMethod": c(ochre, I),
      "operatorOverloaded": c(rust),

      # ── data ──────────────────────────────────────────────────────────
      "property": c(fg), "property.declaration": c(fg, N),
      "property.readonly": c(fg, N), "property.static": c(fg, I),
      "field": c(fg), "field.declaration": c(fg, N),
      "field.readonly": c(fg), "field.static": c(fg, I),
      "variable": c(fg), "variable.declaration": c(fg, N),
      "variable.readonly": c(blue), "variable.readonly.defaultLibrary": c(blue),
      "variable.constant": c(blue), "variable.static": c(fg, I),
      "variable.defaultLibrary": c(rh),
      "local": c(fg),
      "parameter": c(P["mute"], N), "parameter.declaration": c(P["mute"], N),
      "enumMember": c(blue), "event": c(rust, I),
      "label": c(rh),

      # ── literals & lexical ────────────────────────────────────────────
      "string": c(moss), "stringVerbatim": c(moss),
      "stringEscapeCharacter": c(rh),
      "number": c(blue), "keyword": c(rust),
      "plainKeyword": c(rust), "controlKeyword": c(rust, B),
      "preprocessorKeyword": c(P["graphite"], B),
      "preprocessorText": c(P["graphite"]),
      "excludedCode": c(P["dim"], I),
      "operator": c(mute), "punctuation": c(mute),
      "comment": c(graphite, I), "modifier": c(rust),
      "macro": c(rh), "decorator": c(rust, I),
      "*.deprecated": {"fontStyle": "strikethrough"},

      # ── C# regex tokens ───────────────────────────────────────────────
      "regexp": c(rh),
      "regexAnchor": c(rust, B), "regexQuantifier": c(rust, B),
      "regexAlternation": c(rust, B), "regexGrouping": c(ochre),
      "regexCharacterClass": c(vh), "regexText": c(moss),
      "regexSelfEscapedCharacter": c(rh), "regexOtherEscape": c(rh),
      "regexComment": c(graphite, I),

      # ── C# XML doc comments ───────────────────────────────────────────
      "xmlDocCommentText": c(P["graphite_hi"], I),
      "xmlDocCommentName": c(verd, I),
      "xmlDocCommentAttributeName": c(ochre, I),
      "xmlDocCommentAttributeValue": c(moss, I),
      "xmlDocCommentAttributeQuotes": c(P["dim"], I),
      "xmlDocCommentDelimiter": c(P["dim"], I),
      "xmlDocCommentComment": c(graphite, I),
      "xmlDocCommentCDataSection": c(P["graphite_hi"], I),
      "xmlDocCommentEntityReference": c(rh, I),
      "xmlDocCommentProcessingInstruction": c(P["dim"], I),

      # ── JSON / misc ───────────────────────────────────────────────────
      "jsonComment": c(graphite, I),
      "selfKeyword": c(rust, I), "builtinType": c(rust),
      "builtinConstant": c(blue), "unresolvedReference": c(madder, U),
    }

def textmate(P):
    rust, ochre, verd, blue, moss = P["rust"], P["ochre"], P["verdigris"], P["blueprint"], P["moss"]
    fg, mute, dim, graphite, madder = P["fg"], P["mute"], P["dim"], P["graphite"], P["madder"]
    vh, rh, rl, gh = P["verd_hi"], P["rust_hi"], P["rust_lo"], P["graphite_hi"]
    R = []
    def r(name, scopes, fgc=None, st=None, bgc=None):
        s = {}
        if fgc: s["foreground"] = fgc
        if st is not None: s["fontStyle"] = st
        if bgc: s["background"] = bgc
        R.append({"name": name, "scope": scopes, "settings": s})

    # ══ comments ═══════════════════════════════════════════════════════
    r("Comment", ["comment", "punctuation.definition.comment",
                  "comment.block", "comment.line", "string.comment"], graphite, I)
    r("Comment · doc", ["comment.block.documentation", "comment.documentation",
                        "punctuation.definition.comment.documentation"], gh, I)
    r("Comment · TODO/FIXME", ["keyword.codetag", "comment.line.double-slash.todo",
                               "storage.type.class.jsdoc", "keyword.other.documentation"], rust, BI)
    r("Comment · shebang", ["comment.line.number-sign.shebang", "punctuation.definition.comment.shebang"], gh, I)

    # ══ keywords ═══════════════════════════════════════════════════════
    r("Keyword", ["keyword", "keyword.other", "storage.modifier",
                  "keyword.operator.expression", "keyword.operator.new",
                  "keyword.operator.delete", "keyword.operator.instanceof",
                  "keyword.operator.of", "keyword.operator.in",
                  "keyword.operator.typeof", "keyword.operator.void",
                  "keyword.operator.logical.python", "keyword.other.using",
                  "keyword.other.new", "keyword.other.await"], rust, N)
    r("Keyword · control", ["keyword.control", "keyword.control.flow",
                            "keyword.control.conditional", "keyword.control.loop",
                            "keyword.control.trycatch", "keyword.control.exception",
                            "keyword.control.return", "keyword.control.import",
                            "keyword.control.from", "keyword.control.as",
                            "keyword.control.export", "keyword.control.default"], rust, B)
    r("Storage", ["storage", "storage.type", "storage.type.function",
                  "storage.type.class", "storage.type.namespace",
                  "storage.type.interface", "storage.type.enum",
                  "storage.type.struct", "storage.type.record",
                  "storage.type.delegate", "storage.type.event",
                  "storage.type.property", "storage.type.variable",
                  "storage.type.modifier", "keyword.declaration"], rust, N)
    r("Storage · accessor", ["storage.modifier.access", "storage.modifier.cs",
                             "storage.modifier.async", "storage.modifier.static",
                             "storage.modifier.readonly"], rust, N)
    r("Keyword · this/self/base", ["variable.language.this", "variable.language.self",
                                   "variable.language.super", "variable.language.special",
                                   "keyword.other.this.cs", "keyword.other.base.cs",
                                   "constant.language.this"], rust, I)
    r("Preprocessor", ["meta.preprocessor", "keyword.control.directive",
                       "punctuation.definition.directive",
                       "keyword.preprocessor", "entity.name.function.preprocessor",
                       "meta.preprocessor.string"], graphite, B)
    r("Preprocessor · excluded", ["comment.block.preprocessor.cs",
                                  "meta.preprocessor.cs comment"], dim, I)

    # ══ types ══════════════════════════════════════════════════════════
    r("Type", ["entity.name.type", "entity.name.class",
               "entity.other.attribute-name.class",
               "support.type", "support.class", "entity.name.scope-resolution",
               "meta.return-type", "storage.type.object",
               "entity.name.type.class", "entity.name.type.module",
               "entity.name.type.namespace", "entity.name.type.struct",
               "entity.name.type.enum", "entity.name.type.alias",
               "entity.name.type.annotation", "entity.name.type.instance"], verd, N)
    r("Type · interface", ["entity.name.type.interface", "entity.name.interface"], vh, N)
    r("Type · parameter", ["entity.name.type.parameter", "support.type.builtin",
                           "meta.type.parameters entity.name.type",
                           "meta.type.annotation entity.name.type.parameter"], vh, I)
    r("Type · primitive", ["support.type.primitive", "keyword.type",
                           "storage.type.built-in", "support.type.builtin.ts",
                           "keyword.other.type"], rust, N)
    r("Type · generic brackets", ["punctuation.definition.typeparameters",
                                  "punctuation.definition.generic"], mute, N)
    r("Namespace", ["entity.name.namespace", "meta.namespace entity.name",
                    "support.other.namespace", "entity.name.scope-resolution.namespace"], mute, N)

    # ══ functions ══════════════════════════════════════════════════════
    r("Function", ["entity.name.function", "support.function",
                   "meta.function-call entity.name.function",
                   "meta.function-call.generic", "variable.function",
                   "meta.method-call entity.name.function",
                   "entity.name.function.member", "support.function.builtin"], ochre, N)
    r("Function · declaration", ["meta.definition.function entity.name.function",
                                 "meta.definition.method entity.name.function",
                                 "meta.function.definition entity.name.function"], ochre, B)
    r("Function · constructor", ["entity.name.function.constructor",
                                 "meta.method.constructor entity.name.function",
                                 "entity.name.function.definition.special.constructor",
                                 "support.type.exception"], ochre, B)
    r("Function · macro", ["entity.name.function.macro", "support.function.macro"], rh, N)

    # ══ variables / parameters / members ═══════════════════════════════
    r("Variable", ["variable", "variable.other", "variable.other.readwrite",
                   "meta.definition.variable variable.other",
                   "variable.other.object", "variable.other.assignment",
                   "variable.other.declaration"], fg, N)
    r("Variable · parameter", ["variable.parameter", "meta.parameter variable",
                               "variable.other.parameter", "entity.name.variable.parameter",
                               "meta.function.parameters variable"], mute, N)
    r("Variable · property/field", ["variable.other.property",
                                    "variable.other.object.property",
                                    "support.variable.property",
                                    "variable.other.member", "entity.name.variable.field",
                                    "variable.object.property"], fg, N)
    r("Variable · constant", ["variable.other.constant", "variable.other.enummember",
                              "entity.name.constant", "constant.other.caps",
                              "variable.other.constant.property"], blue, N)
    r("Variable · language", ["support.variable", "support.variable.dom",
                              "support.variable.object.process",
                              "support.variable.object.node",
                              "support.constant.node"], rh, N)
    r("Variable · unused", ["variable.other.unused"], dim, N)

    # ══ constants & literals ═══════════════════════════════════════════
    r("Number", ["constant.numeric", "constant.numeric.integer",
                 "constant.numeric.float", "constant.numeric.hex",
                 "constant.numeric.binary", "constant.numeric.octal",
                 "keyword.other.unit", "constant.numeric.decimal"], blue, N)
    r("Constant · language", ["constant.language", "constant.language.boolean",
                              "constant.language.null", "constant.language.undefined",
                              "constant.language.nan", "constant.language.infinity",
                              "support.constant", "constant.other.color"], blue, N)
    r("Constant · other", ["constant", "constant.other", "constant.other.key"], blue, N)
    r("Escape", ["constant.character.escape", "constant.character",
                 "constant.character.entity", "punctuation.definition.entity",
                 "constant.other.character-class.escape"], rh, N)

    # ══ strings ════════════════════════════════════════════════════════
    r("String", ["string", "string.quoted", "string.quoted.single",
                 "string.quoted.double", "string.quoted.triple",
                 "string.unquoted", "string.template", "string.other",
                 "meta.attribute-selector string"], moss, N)
    r("String · punctuation", ["punctuation.definition.string",
                               "punctuation.definition.string.begin",
                               "punctuation.definition.string.end",
                               "punctuation.definition.template-expression"], mix(P["bg"], moss, .72), N)
    r("String · interpolation", ["meta.template.expression",
                                 "meta.embedded.line.cs",
                                 "meta.interpolation", "punctuation.section.embedded"], fg, N)
    r("String · verbatim/raw", ["string.quoted.double.raw", "string.regexp.raw",
                                "string.quoted.other.raw"], moss, N)
    r("String · symbol/key", ["constant.other.symbol", "string.unquoted.key"], moss, N)

    # ══ regex ══════════════════════════════════════════════════════════
    r("Regex", ["string.regexp", "string.regexp.ts"], rh, N)
    r("Regex · anchor/quantifier", ["keyword.control.anchor.regexp",
                                    "keyword.operator.quantifier.regexp",
                                    "keyword.operator.or.regexp",
                                    "keyword.operator.negation.regexp",
                                    "punctuation.definition.group.assertion.regexp"], rust, B)
    r("Regex · group", ["meta.group.regexp", "punctuation.definition.group.regexp",
                        "meta.assertion.look-ahead.regexp"], ochre, N)
    r("Regex · group name", ["variable.other.regexp",
                             "meta.group.regexp variable.other"], ochre, N)
    r("Regex · char class", ["constant.other.character-class.regexp",
                             "constant.other.character-class.set.regexp",
                             "punctuation.definition.character-class.regexp"], vh, N)

    # ══ operators & punctuation ════════════════════════════════════════
    r("Operator", ["keyword.operator", "keyword.operator.arithmetic",
                   "keyword.operator.assignment", "keyword.operator.comparison",
                   "keyword.operator.logical", "keyword.operator.bitwise",
                   "keyword.operator.ternary", "keyword.operator.relational",
                   "keyword.operator.increment", "keyword.operator.decrement",
                   "keyword.operator.arrow", "keyword.operator.optional",
                   "keyword.operator.definiteassignment",
                   "keyword.operator.type.annotation", "keyword.operator.spread",
                   "keyword.operator.rest", "keyword.operator.nullish-coalescing"], mute, N)
    r("Punctuation", ["punctuation", "punctuation.separator", "punctuation.terminator",
                      "punctuation.terminator.statement", "punctuation.terminator.rule",
                      "punctuation.terminator.expression",
                      "punctuation.definition.parameters",
                      "punctuation.definition.arguments",
                      "punctuation.definition.array",
                      "meta.brace",
                      "punctuation.section.block", "punctuation.definition.block",
                      "punctuation.definition.bracket",
                      "punctuation.section.parens", "punctuation.section.brackets",
                      "punctuation.section.braces"], mute, N)
    r("Punctuation · accessor", ["punctuation.accessor", "punctuation.separator.period",
                                 "punctuation.separator.namespace"], mix(P["bg"], mute, .82), N)

    # ══ attributes & decorators ════════════════════════════════════════
    r("Attribute · C#", ["meta.attribute.cs entity.name.type",
                         "meta.attribute.cs", "storage.type.attribute"], rust, I)
    r("Attribute · brackets", ["punctuation.squarebracket.open.cs",
                               "punctuation.squarebracket.close.cs"], mute, N)
    r("Decorator · TS", ["meta.decorator", "meta.decorator punctuation.decorator",
                         "entity.name.function.decorator",
                         "meta.decorator entity.name.function",
                         "meta.decorator meta.function-call entity.name.function",
                         "meta.decorator meta.function-call.ts entity.name.function.ts",
                         "punctuation.decorator", "meta.decorator variable.other"], rust, I)

    # ══ C# specifics ═══════════════════════════════════════════════════
    r("C# · using directive", ["keyword.other.using.cs", "keyword.other.using.directive.cs"], rust, N)
    r("C# · nullable", ["punctuation.separator.question-mark.cs",
                        "keyword.operator.nullable.cs"], rust, N)
    r("C# · verbatim string", ["string.quoted.double.literal.cs",
                               "punctuation.definition.string.begin.cs",
                               "punctuation.definition.string.end.cs"], moss, N)
    r("C# · interpolation braces", ["punctuation.definition.interpolation.begin.cs",
                                    "punctuation.definition.interpolation.end.cs"], rust, N)
    r("C# · XML doc tag", ["comment.block.documentation.cs entity.name.tag",
                           "comment.block.documentation.cs entity.name.tag.cs"], verd, I)
    r("C# · XML doc attr", ["comment.block.documentation.cs entity.other.attribute-name"], ochre, I)
    r("C# · XML doc delims", ["comment.block.documentation.cs punctuation.definition.tag"], dim, I)
    r("C# · LINQ", ["keyword.query.cs", "keyword.other.linq"], rust, BI)
    r("C# · label", ["entity.name.label.cs"], rh, N)

    # ══ TypeScript / JavaScript specifics ══════════════════════════════
    r("TS · import/export", ["keyword.control.import.ts", "keyword.control.export.ts",
                             "keyword.control.from.ts", "keyword.control.import.tsx",
                             "keyword.control.export.tsx"], rust, B)
    r("TS · type keyword", ["keyword.control.type.ts", "keyword.control.satisfies",
                            "keyword.control.as.ts"], rust, I)
    r("TS · module/require", ["support.module", "support.node", "meta.import",
                              "meta.export"], mute, N)
    r("TS · object literal key", ["meta.object-literal.key",
                                  "meta.object-literal.key string"], fg, N)
    r("TS · optional chaining", ["punctuation.accessor.optional"], rust, N)
    r("JSDoc · type", ["entity.name.type.instance.jsdoc",
                       "entity.name.type.jsdoc"], verd, I)
    r("JSDoc · variable", ["variable.other.jsdoc", "variable.other.description.jsdoc"], gh, I)

    # ══ JSX / TSX ══════════════════════════════════════════════════════
    r("JSX · component", ["support.class.component",
                          "entity.name.tag.tsx", "entity.name.tag.js",
                          "support.class.component.tsx"], verd, N)
    r("JSX · intrinsic tag", ["entity.name.tag.html", "entity.name.tag"], rust, N)
    r("JSX · attribute", ["entity.other.attribute-name",
                          "entity.other.attribute-name.tsx",
                          "entity.other.attribute-name.html"], ochre, I)
    r("JSX · brackets", ["punctuation.definition.tag", "meta.tag punctuation",
                         "punctuation.definition.tag.begin",
                         "punctuation.definition.tag.end"], mute, N)
    r("JSX · text", ["meta.jsx.children", "JSXNested"], fg, N)

    # ══ HTML / CSS ═════════════════════════════════════════════════════
    r("CSS · selector", ["entity.name.tag.css", "entity.other.attribute-name.class.css",
                         "entity.other.attribute-name.id.css",
                         "entity.other.attribute-name.pseudo-class.css",
                         "entity.other.attribute-name.pseudo-element.css",
                         "meta.selector"], verd, N)
    r("CSS · property", ["support.type.property-name.css",
                         "support.type.property-name.scss",
                         "support.type.property-name.less",
                         "meta.property-name"], fg, N)
    r("CSS · value", ["support.constant.property-value.css",
                      "support.constant.color", "meta.property-value"], blue, N)
    r("CSS · unit", ["keyword.other.unit.css", "constant.numeric.css"], blue, N)
    r("CSS · at-rule", ["keyword.control.at-rule", "punctuation.definition.keyword.css"], rust, B)
    r("CSS · variable", ["variable.css", "variable.argument.css",
                         "variable.other.custom-property"], rh, N)

    # ══ Markdown ═══════════════════════════════════════════════════════
    r("MD · heading", ["markup.heading", "entity.name.section.markdown",
                       "punctuation.definition.heading.markdown"], rust, B)
    r("MD · bold", ["markup.bold", "markup.bold.markdown"], fg, B)
    r("MD · italic", ["markup.italic", "markup.italic.markdown"], fg, I)
    r("MD · strikethrough", ["markup.strikethrough"], dim, "strikethrough")
    r("MD · link", ["markup.underline.link", "string.other.link",
                    "constant.other.reference.link.markdown"], verd, U)
    r("MD · link text", ["string.other.link.title.markdown",
                         "string.other.link.description.markdown"], ochre, N)
    r("MD · code", ["markup.inline.raw", "markup.fenced_code.block",
                    "markup.raw.block"], moss, N)
    r("MD · code fence", ["punctuation.definition.markdown",
                          "fenced_code.block.language"], graphite, N)
    r("MD · quote", ["markup.quote", "beginning.punctuation.definition.quote.markdown"], gh, I)
    r("MD · list", ["beginning.punctuation.definition.list.markdown",
                    "markup.list"], rust, N)
    r("MD · table", ["markup.table", "punctuation.definition.table"], mute, N)

    # ══ data formats ═══════════════════════════════════════════════════
    r("JSON · key", ["support.type.property-name.json",
                     "meta.structure.dictionary.json string.quoted.double"], verd, N)
    r("JSON · key L2", ["meta.structure.dictionary.value.json string.quoted.double"], moss, N)
    r("YAML · key", ["entity.name.tag.yaml", "punctuation.definition.entry.yaml"], verd, N)
    r("YAML · anchor", ["entity.name.type.anchor.yaml", "variable.other.alias.yaml"], rh, N)
    r("TOML · key", ["support.type.property-name.toml", "entity.name.tag.toml"], verd, N)
    r("TOML · table", ["entity.other.attribute-name.table.toml"], rust, B)
    r("XML · tag", ["entity.name.tag.xml", "entity.name.tag.localname.xml"], verd, N)
    r("XML · attribute", ["entity.other.attribute-name.xml",
                          "entity.other.attribute-name.localname.xml"], ochre, I)
    r("INI · key", ["keyword.other.definition.ini"], verd, N)
    r("INI · section", ["entity.name.section.group-title.ini"], rust, B)
    r("Env · key", ["variable.other.env", "keyword.other.definition.env"], verd, N)

    # ══ shell / sql / other langs ══════════════════════════════════════
    r("Shell · variable", ["variable.other.normal.shell", "variable.other.special.shell",
                           "punctuation.definition.variable.shell"], rh, N)
    r("Shell · builtin", ["support.function.builtin.shell",
                          "entity.name.command.shell"], ochre, N)
    r("SQL · keyword", ["keyword.other.DML", "keyword.other.DDL",
                        "keyword.other.create.sql", "keyword.other.sql"], rust, B)
    r("Python · decorator", ["entity.name.function.decorator.python",
                             "meta.function.decorator.python"], rust, I)
    r("Python · self", ["variable.parameter.function.language.special.self.python"], rust, I)
    r("Go · package", ["keyword.package.go", "keyword.import.go"], rust, B)
    r("Rust · lifetime", ["storage.modifier.lifetime.rust",
                          "entity.name.type.lifetime.rust"], rh, I)
    r("Rust · macro", ["entity.name.function.macro.rust", "support.function.core.rust"], rh, N)

    # ══ diff / git ═════════════════════════════════════════════════════
    r("Diff · inserted", ["markup.inserted", "markup.inserted.diff",
                          "punctuation.definition.inserted"], moss, N)
    r("Diff · deleted", ["markup.deleted", "markup.deleted.diff",
                         "punctuation.definition.deleted"], madder, N)
    r("Diff · changed", ["markup.changed", "markup.changed.diff"], ochre, N)
    r("Diff · header", ["meta.diff.header", "meta.diff.range",
                        "meta.diff.header.from-file", "meta.diff.header.to-file"], blue, B)
    r("Git · commit", ["meta.diff.index", "constant.other.reference.commit"], mute, N)

    # ══ invalid / deprecated ═══════════════════════════════════════════
    r("Invalid", ["invalid", "invalid.illegal"], madder, N)
    r("Invalid · deprecated", ["invalid.deprecated"], ochre, "strikethrough")
    r("Broken", ["invalid.broken"], madder, I)

    # ══ misc ═══════════════════════════════════════════════════════════
    r("Embedded", ["meta.embedded", "source.groovy.embedded",
                   "meta.embedded.block"], fg, N)
    r("Inherited class", ["entity.other.inherited-class"], vh, I)
    r("Section", ["entity.name.section", "meta.tag.sgml"], rust, B)
    r("Bold/italic markup", ["markup.bold markup.italic",
                             "markup.italic markup.bold"], fg, BI)
    return R
