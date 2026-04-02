import * as vscode from 'vscode';
import {
  findNearestClassMatch,
  mergeClassTokens,
  normalizeColorClass,
  normalizeMeasurementClass,
  splitClassesPreservingBrackets,
  upsertGroupedClass,
} from './class-utils';
import { buildCssDeclarationEdit, findNearestCssRule } from './css-utils';

type ViewState = {
  mode: 'none' | 'class' | 'css';
  hasTarget: boolean;
  filePath: string | null;
  message: string;
  previewUrl: string;
  controlsUrl: string;
  attribute: string | null;
  tokens: string[];
  cssSelector: string | null;
  cssDeclarations: Record<string, string>;
};

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ClassEditorViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ycodeCssEditor.sidebar', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ycodeCssEditor.focus', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.ycodeCssEditor');
      await vscode.commands.executeCommand('ycodeCssEditor.sidebar.focus');
    }),
  );
}

export function deactivate(): void {
  // no-op
}

class ClassEditorViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const { webview } = webviewView;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage(async (message: WebviewMessage) => {
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
        await this.applyUpdate((tokens) => upsertGroupedClass(tokens, message.group, message.value || null));
        return;
      }

      if (message.type === 'setMeasurement') {
        const nextClass = normalizeMeasurementClass(message.prefix, message.value);
        await this.applyUpdate((tokens) => upsertGroupedClass(tokens, message.group, nextClass));
        return;
      }

      if (message.type === 'setColor') {
        const nextClass = normalizeColorClass(message.prefix, message.value);
        await this.applyUpdate((tokens) => upsertGroupedClass(tokens, message.group, nextClass));
      }
    });

    const trigger = async (): Promise<void> => {
      await this.postState();
    };

    this.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(trigger));
    this.context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(trigger));
    this.context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(trigger));

    void this.postState();
  }

  private async applyUpdate(mutator: (tokens: string[]) => string[]): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const match = this.getCurrentMatch(editor);
    if (!match) {
      return;
    }

    const currentTokens = splitClassesPreservingBrackets(match.value);
    const nextTokens = mutator(currentTokens);
    const nextValue = mergeClassTokens(nextTokens);
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

  private async applyCssPropertyUpdate(property: string, value: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isCssDocument(editor.document)) {
      return;
    }

    const text = editor.document.getText();
    const offset = editor.document.offsetAt(editor.selection.active);
    const rule = findNearestCssRule(text, offset);
    if (!rule) {
      return;
    }

    const edit = buildCssDeclarationEdit(text, rule, property, value);
    const range = new vscode.Range(
      editor.document.positionAt(edit.start),
      editor.document.positionAt(edit.end),
    );

    const didApply = await editor.edit((editBuilder) => {
      editBuilder.replace(range, edit.newText);
    });

    if (didApply) {
      await this.postState();
    }
  }

  private async applyCssDeclarationsUpdate(declarations: Record<string, string>): Promise<void> {
    const entries = Object.entries(declarations).filter(([, value]) => !!value);
    for (const [property, value] of entries) {
      await this.applyCssPropertyUpdate(property, value);
    }
  }

  private getCurrentMatch(editor: vscode.TextEditor) {
    const text = editor.document.getText();
    const offset = editor.document.offsetAt(editor.selection.active);
    return findNearestClassMatch(text, offset);
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }

    const state = this.getState();
    await this.view.webview.postMessage({
      type: 'state',
      payload: state,
    });
  }

  private getState(): ViewState {
    const previewUrl =
      vscode.workspace.getConfiguration().get<string>('ycodeCssEditor.previewUrl') || 'http://localhost:3000';
    const controlsUrl =
      vscode.workspace.getConfiguration().get<string>('ycodeCssEditor.controlsUrl') || 'http://localhost:3002';
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
      const cssRule = findNearestCssRule(text, offset);
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

      const cssDeclarations: Record<string, string> = {};
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

    const tokens = splitClassesPreservingBrackets(match.value);
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

  private isCssDocument(document: vscode.TextDocument): boolean {
    const language = document.languageId;
    if (['css', 'scss', 'less', 'postcss'].includes(language)) {
      return true;
    }
    const path = document.uri.fsPath.toLowerCase();
    return path.endsWith('.css') || path.endsWith('.scss') || path.endsWith('.less');
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'),
    );
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

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

type WebviewMessage =
  | { type: 'ready' | 'requestState' }
  | { type: 'setPreviewUrl'; value: string }
  | { type: 'setControlsUrl'; value: string }
  | { type: 'applyCssDeclarations'; declarations: Record<string, string> }
  | { type: 'removeClass'; value: string }
  | { type: 'addClass'; value: string }
  | { type: 'setGroupedClass'; group: string; value: string }
  | { type: 'setMeasurement'; group: string; prefix: string; value: string }
  | { type: 'setColor'; group: string; prefix: 'text' | 'bg'; value: string };
