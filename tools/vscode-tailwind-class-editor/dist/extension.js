"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const class_utils_1 = require("./class-utils");
const css_utils_1 = require("./css-utils");
function activate(context) {
    const provider = new ClassEditorViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('ycodeCssEditor.sidebar', provider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ycodeCssEditor.focus', async () => {
        await vscode.commands.executeCommand('workbench.view.extension.ycodeCssEditor');
        await vscode.commands.executeCommand('ycodeCssEditor.sidebar.focus');
    }));
}
function deactivate() {
    // no-op
}
class ClassEditorViewProvider {
    constructor(context) {
        this.context = context;
        this.view = null;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        const { webview } = webviewView;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };
        webview.html = this.getHtml(webview);
        webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'ready' || message.type === 'requestState') {
                await this.postState();
                return;
            }
            if (message.type === 'setPreviewUrl') {
                const normalized = message.value.trim();
                const nextValue = normalized || 'http://localhost:3000';
                await vscode.workspace
                    .getConfiguration()
                    .update('ycodeCssEditor.previewUrl', nextValue, vscode.ConfigurationTarget.Workspace);
                await this.postState();
                return;
            }
            if (message.type === 'setControlsUrl') {
                const normalized = message.value.trim();
                const nextValue = normalized || 'http://localhost:3002';
                await vscode.workspace
                    .getConfiguration()
                    .update('ycodeCssEditor.controlsUrl', nextValue, vscode.ConfigurationTarget.Workspace);
                await this.postState();
                return;
            }
            if (message.type === 'applyCssDeclarations') {
                await this.applyCssDeclarationsUpdate(message.declarations);
                return;
            }
            if (message.type === 'removeClass') {
                await this.applyUpdate((tokens) => tokens.filter((token) => token !== message.value));
                return;
            }
            if (message.type === 'addClass') {
                await this.applyUpdate((tokens) => {
                    const next = message.value.trim();
                    if (!next || tokens.includes(next)) {
                        return tokens;
                    }
                    return [...tokens, next];
                });
                return;
            }
            if (message.type === 'setGroupedClass') {
                await this.applyUpdate((tokens) => (0, class_utils_1.upsertGroupedClass)(tokens, message.group, message.value || null));
                return;
            }
            if (message.type === 'setMeasurement') {
                const nextClass = (0, class_utils_1.normalizeMeasurementClass)(message.prefix, message.value);
                await this.applyUpdate((tokens) => (0, class_utils_1.upsertGroupedClass)(tokens, message.group, nextClass));
                return;
            }
            if (message.type === 'setColor') {
                const nextClass = (0, class_utils_1.normalizeColorClass)(message.prefix, message.value);
                await this.applyUpdate((tokens) => (0, class_utils_1.upsertGroupedClass)(tokens, message.group, nextClass));
            }
        });
        const trigger = async () => {
            await this.postState();
        };
        this.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(trigger));
        this.context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(trigger));
        this.context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(trigger));
        void this.postState();
    }
    async applyUpdate(mutator) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const match = this.getCurrentMatch(editor);
        if (!match) {
            return;
        }
        const currentTokens = (0, class_utils_1.splitClassesPreservingBrackets)(match.value);
        const nextTokens = mutator(currentTokens);
        const nextValue = (0, class_utils_1.mergeClassTokens)(nextTokens);
        if (nextValue === match.value) {
            return;
        }
        const range = new vscode.Range(editor.document.positionAt(match.start), editor.document.positionAt(match.end));
        const didApply = await editor.edit((editBuilder) => {
            editBuilder.replace(range, nextValue);
        });
        if (didApply) {
            await this.postState();
        }
    }
    async applyCssPropertyUpdate(property, value) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.isCssDocument(editor.document)) {
            return;
        }
        const text = editor.document.getText();
        const offset = editor.document.offsetAt(editor.selection.active);
        const rule = (0, css_utils_1.findNearestCssRule)(text, offset);
        if (!rule) {
            return;
        }
        const edit = (0, css_utils_1.buildCssDeclarationEdit)(text, rule, property, value);
        const range = new vscode.Range(editor.document.positionAt(edit.start), editor.document.positionAt(edit.end));
        const didApply = await editor.edit((editBuilder) => {
            editBuilder.replace(range, edit.newText);
        });
        if (didApply) {
            await this.postState();
        }
    }
    async applyCssDeclarationsUpdate(declarations) {
        const entries = Object.entries(declarations).filter(([, value]) => !!value);
        for (const [property, value] of entries) {
            await this.applyCssPropertyUpdate(property, value);
        }
    }
    getCurrentMatch(editor) {
        const text = editor.document.getText();
        const offset = editor.document.offsetAt(editor.selection.active);
        return (0, class_utils_1.findNearestClassMatch)(text, offset);
    }
    async postState() {
        if (!this.view) {
            return;
        }
        const state = this.getState();
        await this.view.webview.postMessage({
            type: 'state',
            payload: state,
        });
    }
    getState() {
        const previewUrl = vscode.workspace.getConfiguration().get('ycodeCssEditor.previewUrl') || 'http://localhost:3000';
        const controlsUrl = vscode.workspace.getConfiguration().get('ycodeCssEditor.controlsUrl') || 'http://localhost:3002';
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return {
                mode: 'none',
                hasTarget: false,
                filePath: null,
                message: 'Keine aktive Datei geöffnet.',
                previewUrl,
                controlsUrl,
                attribute: null,
                tokens: [],
                cssSelector: null,
                cssDeclarations: {},
            };
        }
        if (this.isCssDocument(editor.document)) {
            const text = editor.document.getText();
            const offset = editor.document.offsetAt(editor.selection.active);
            const cssRule = (0, css_utils_1.findNearestCssRule)(text, offset);
            if (!cssRule) {
                return {
                    mode: 'css',
                    hasTarget: false,
                    filePath: editor.document.uri.fsPath,
                    message: 'Kein CSS-Block am Cursor gefunden.',
                    previewUrl,
                    controlsUrl,
                    attribute: null,
                    tokens: [],
                    cssSelector: null,
                    cssDeclarations: {},
                };
            }
            const cssDeclarations = {};
            cssRule.declarations.forEach((decl) => {
                cssDeclarations[decl.property] = decl.value;
            });
            return {
                mode: 'css',
                hasTarget: true,
                filePath: editor.document.uri.fsPath,
                message: 'CSS-Regler aktiv',
                previewUrl,
                controlsUrl,
                attribute: null,
                tokens: [],
                cssSelector: cssRule.selector,
                cssDeclarations,
            };
        }
        const match = this.getCurrentMatch(editor);
        if (!match) {
            return {
                mode: 'class',
                hasTarget: false,
                filePath: editor.document.uri.fsPath,
                message: 'Kein class/className am Cursor gefunden.',
                previewUrl,
                controlsUrl,
                attribute: null,
                tokens: [],
                cssSelector: null,
                cssDeclarations: {},
            };
        }
        const tokens = (0, class_utils_1.splitClassesPreservingBrackets)(match.value);
        return {
            mode: 'class',
            hasTarget: true,
            filePath: editor.document.uri.fsPath,
            message: 'Tailwind Klassen erkannt',
            previewUrl,
            controlsUrl,
            attribute: match.attribute,
            tokens,
            cssSelector: null,
            cssDeclarations: {},
        };
    }
    isCssDocument(document) {
        const language = document.languageId;
        if (['css', 'scss', 'less', 'postcss'].includes(language)) {
            return true;
        }
        const path = document.uri.fsPath.toLowerCase();
        return path.endsWith('.css') || path.endsWith('.scss') || path.endsWith('.less');
    }
    getHtml(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'));
        const nonce = createNonce();
        return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; frame-src http: https:; img-src ${webview.cspSource} https: data:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>YCode Class Editor</title>
  </head>
  <body>
    <div id="app">
      <header class="header">
        <strong>YCode CSS Live Editor</strong>
        <p id="meta"></p>
      </header>

      <section class="section">
        <div class="section-title">Live Preview URL</div>
        <div class="inline-row">
          <input id="previewUrl" type="text" placeholder="http://localhost:3000" />
          <button id="savePreviewUrl">Save</button>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Controls URL (YCode)</div>
        <div class="inline-row">
          <input id="controlsUrl" type="text" placeholder="http://localhost:3002" />
          <button id="saveControlsUrl">Save</button>
        </div>
      </section>

      <section id="cssControls" class="section">
        <div class="section-title">YCode Design Controls (1:1)</div>
        <p id="selectorLabel" class="muted"></p>
        <iframe id="controlsFrame" title="YCode Controls"></iframe>
      </section>

      <section id="classControls" class="section">
        <div class="section-title">Tailwind Klassen (Fallback)</div>
        <label class="field">
          <span>Display</span>
          <select id="display">
            <option value="">(keep)</option>
            <option value="block">block</option>
            <option value="inline-block">inline-block</option>
            <option value="inline">inline</option>
            <option value="flex">flex</option>
            <option value="inline-flex">inline-flex</option>
            <option value="grid">grid</option>
            <option value="hidden">hidden</option>
          </select>
        </label>
        <label class="field">
          <span>Font size (e.g. 14, 1rem, text-sm)</span>
          <input id="fontSize" type="text" placeholder="14" />
        </label>
        <label class="field">
          <span>Padding (e.g. 16, 1rem, p-4)</span>
          <input id="padding" type="text" placeholder="16" />
        </label>
        <label class="field">
          <span>Margin (e.g. 8, auto, m-2)</span>
          <input id="margin" type="text" placeholder="8" />
        </label>
        <label class="field">
          <span>Radius (e.g. 8, md, rounded-lg)</span>
          <input id="radius" type="text" placeholder="8" />
        </label>
        <label class="field">
          <span>Text color (e.g. slate-900, #111827)</span>
          <input id="textColor" type="text" placeholder="slate-900" />
        </label>
        <label class="field">
          <span>Background color (e.g. blue-500, #3b82f6)</span>
          <input id="bgColor" type="text" placeholder="blue-500" />
        </label>
      </section>

      <section class="section">
        <div class="section-title">Current Classes (Fallback)</div>
        <div id="chips" class="chips"></div>
      </section>

      <section class="section">
        <div class="section-title">Preview</div>
        <iframe id="preview" title="Preview"></iframe>
      </section>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
    }
}
function createNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i += 1) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
