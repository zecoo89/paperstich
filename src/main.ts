import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

type FitMode = "fill" | "fit" | "center";
type Language = "ja" | "en";

const LANGUAGE_STORAGE_KEY = "paperstich.language";
const messages: Record<Language, Record<string, string>> = {
  ja: {
    language: "言語", japanese: "日本語", english: "English",
    displayMode: "表示方法",
    refreshDisplays: "モニターを再検出", fitFill: "画面いっぱい（切り抜き）", fitFit: "全体を表示（余白あり）", fitCenter: "中央に原寸表示",
    applyWallpaper: "壁紙を適用", addDirectory: "画像ディレクトリを追加", directoryListLabel: "保存済み画像ディレクトリ",
    libraryHint: "画像ディレクトリを追加すると、その中の画像を一覧表示します", dropDirectoryHint: "画像ディレクトリをここへドロップするか、右上のボタンから追加してください", loadingDirectories: "画像を読み込んでいます…", noDisplays: "モニターを検出できません", canvasLabel: "モニター配置。クリックして選択",
    previewHeight: "プレビュー高さ", thumbnailSize: "サムネイルサイズ", imageLibrary: "画像ライブラリ",
    selectDisplay: "モニターを選択してください", assignHint: "{connector}に割り当てる画像をクリックしてください", imageCount: "{count}枚",
    noDirectories: "保存済みのディレクトリはありません", remove: "削除", selectDisplayFirst: "先に配置図のモニターをクリックしてください",
    noMonitor: "モニターが検出されていません",
    unselectedImages: "画像が未選択です: {connectors}", loadingImages: "画像の読み込みが完了していません: {connectors}",
    imageLoadError: "画像を読み込めません: {name}", directoryTitle: "画像ディレクトリを選択",
    directoryUpdateError: "画像ディレクトリの更新に失敗しました（{directory}）: {error}", directoryLoadError: "画像ディレクトリを読み込めません: {error}", savedDirectoryError: "保存済み画像ディレクトリを読み込めません: {error}",
  },
  en: {
    language: "Language", japanese: "日本語", english: "English",
    displayMode: "Display mode",
    refreshDisplays: "Refresh monitors", fitFill: "Fill (crop)", fitFit: "Fit (letterbox)", fitCenter: "Center at native size",
    applyWallpaper: "Apply wallpaper", addDirectory: "Add image directories", directoryListLabel: "Saved image directories",
    libraryHint: "Add image directories to display their contents", dropDirectoryHint: "Drop image directories here, or add them with the button above", loadingDirectories: "Loading images…", noDisplays: "No monitors detected", canvasLabel: "Monitor layout. Click to select",
    previewHeight: "Preview height", thumbnailSize: "Thumbnail size", imageLibrary: "Image library",
    selectDisplay: "Select a monitor", assignHint: "Click an image to assign it to {connector}", imageCount: "{count} images",
    noDirectories: "No saved directories", remove: "Remove", selectDisplayFirst: "Select a monitor in the preview first",
    noMonitor: "No monitors detected",
    unselectedImages: "Images not selected: {connectors}", loadingImages: "Images are still loading: {connectors}",
    imageLoadError: "Unable to load image: {name}", directoryTitle: "Select image directories",
    directoryUpdateError: "Unable to update image directory ({directory}): {error}", directoryLoadError: "Unable to load image directories: {error}", savedDirectoryError: "Unable to restore saved image directories: {error}",
  },
};

function detectLanguage(): Language {
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function formatMessage(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

let currentLanguage: Language = detectLanguage();
function t(key: string, values?: Record<string, string | number>): string {
  const template = messages[currentLanguage][key];
  if (!template) throw new Error(`Missing translation: ${currentLanguage}.${key}`);
  return formatMessage(template, values);
}

function readSavedLanguage(): Language {
  const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (raw === null) return detectLanguage();
  if (raw !== "ja" && raw !== "en") throw new Error(`Invalid saved language: ${raw}`);
  return raw;
}

function applyLanguage(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (!key) throw new Error("Translation key is missing");
    element.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((element) => {
    for (const definition of element.dataset.i18nAttr!.split(",")) {
      const [attribute, key] = definition.split(":");
      if (!attribute || !key) throw new Error(`Invalid translation attribute: ${definition}`);
      element.setAttribute(attribute, t(key));
    }
  });
  languageSelect.value = currentLanguage;
  document.documentElement.lang = currentLanguage;
  updateSelectedControls();
  renderGallery();
  renderDirectoryList();
  drawCanvas();
}

function setLanguage(language: Language): void {
  if (language !== "ja" && language !== "en") throw new Error(`Unsupported language: ${language}`);
  currentLanguage = language;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  applyLanguage();
}

interface Display {
  connector: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

interface ImageEntry {
  id: number;
  name: string;
  sourceKey: string;
  url: string;
  image: HTMLImageElement | null;
}

interface DirectoryImage {
  path: string;
  name: string;
  dataUrl: string;
}

interface WallpaperChoice {
  imageId: number;
  mode: FitMode;
}

interface SavedWallpaperChoice {
  path: string;
  mode: FitMode;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required PaperStich UI element not found: ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>("#monitor-canvas");
const fitMode = required<HTMLSelectElement>("#fit-mode");
const gallery = required<HTMLElement>("#gallery");
const imageCount = required<HTMLElement>("#image-count");
const libraryHint = required<HTMLElement>("#library-hint");
const status = required<HTMLElement>("#status");
const refreshButton = required<HTMLButtonElement>("#refresh-displays");
const applyButton = required<HTMLButtonElement>("#apply-wallpaper");
const addFolderButton = required<HTMLButtonElement>("#add-folder");
const directoryList = required<HTMLElement>("#directory-list");
const thumbnailSizeInput = required<HTMLInputElement>("#thumbnail-size");
const thumbnailSizeValue = required<HTMLOutputElement>("#thumbnail-size-value");
const previewHeightInput = required<HTMLInputElement>("#preview-height");
const previewHeightValue = required<HTMLOutputElement>("#preview-height-value");
const languageSelect = required<HTMLSelectElement>("#language-select");
const directoryLoadingOverlay = required<HTMLElement>("#directory-loading-overlay");

const DIRECTORY_STORAGE_KEY = "paperstich.image-directories";
const WALLPAPER_CHOICES_STORAGE_KEY = "paperstich.wallpaper-choices";

const state = {
  displays: [] as Display[],
  entries: [] as ImageEntry[],
  choices: new Map<string, WallpaperChoice>(),
  targetConnector: null as string | null,
  directories: [] as string[],
  savedChoices: new Map<string, SavedWallpaperChoice>(),
  thumbnailSize: 160,
  previewHeight: 420,
  nextImageId: 1,
};
const fitLabelKeys: Record<FitMode, string> = {
  fill: "fitFill", fit: "fitFit", center: "fitCenter",
};
function fitLabel(mode: FitMode): string { return t(fitLabelKeys[mode]); }

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function clearStatus(): void {
  status.replaceChildren();
  status.classList.remove("error");
}

function getTargetDisplay(): Display | undefined {
  return state.displays.find((display) => display.connector === state.targetConnector);
}

function getEntry(imageId: number): ImageEntry | undefined {
  return state.entries.find((entry) => entry.id === imageId);
}

function getBounds(): { left: number; top: number; width: number; height: number } | null {
  if (state.displays.length === 0) return null;
  const left = Math.min(...state.displays.map((display) => display.x));
  const top = Math.min(...state.displays.map((display) => display.y));
  const right = Math.max(...state.displays.map((display) => display.x + display.width));
  const bottom = Math.max(...state.displays.map((display) => display.y + display.height));
  return { left, top, width: right - left, height: bottom - top };
}

function drawImageForMode(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  display: Display,
  bounds: { left: number; top: number },
  mode: FitMode,
): void {
  const x = display.x - bounds.left;
  const y = display.y - bounds.top;
  const width = display.width;
  const height = display.height;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();

  if (mode === "fill") {
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    if (sourceRatio > targetRatio) {
      sourceWidth = image.naturalHeight * targetRatio;
    } else {
      sourceHeight = image.naturalWidth / targetRatio;
    }
    const sourceX = (image.naturalWidth - sourceWidth) / 2;
    const sourceY = (image.naturalHeight - sourceHeight) / 2;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  } else if (mode === "fit") {
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    const sourceWidth = Math.min(image.naturalWidth, width);
    const sourceHeight = Math.min(image.naturalHeight, height);
    const sourceX = Math.max(0, (image.naturalWidth - sourceWidth) / 2);
    const sourceY = Math.max(0, (image.naturalHeight - sourceHeight) / 2);
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight,
      x + (width - sourceWidth) / 2, y + (height - sourceHeight) / 2, sourceWidth, sourceHeight);
  }
  context.restore();
}

function drawLabel(context: CanvasRenderingContext2D, display: Display, x: number, y: number, choice?: WallpaperChoice): void {
  const titleSize = Math.max(16, Math.min(42, display.height / 9));
  const detailSize = Math.max(12, Math.min(24, display.height / 14));
  const labelHeight = titleSize + detailSize + 28;
  context.fillStyle = "rgba(5, 7, 10, .62)";
  context.fillRect(x, y, display.width, labelHeight);
  context.fillStyle = "#ffffff";
  context.font = `700 ${titleSize}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`${display.connector}${display.primary ? " ★" : ""}`, x + display.width / 2, y + titleSize / 2 + 8);
  context.font = `600 ${detailSize}px sans-serif`;
  const detail = choice ? fitLabel(choice.mode) : `${display.width} × ${display.height}`;
  context.fillText(detail, x + display.width / 2, y + titleSize + detailSize / 2 + 14);
}

function drawScene(targetCanvas: HTMLCanvasElement, showAnnotations: boolean): void {
  const bounds = getBounds();
  const context = targetCanvas.getContext("2d");
  if (!context) throw new Error("Unable to get the Canvas 2D context");
  const background = showAnnotations ? "#0f172a" : "#e8eef7";

  if (!bounds) {
    targetCanvas.width = 1200;
    targetCanvas.height = 260;
    context.fillStyle = background;
    context.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    if (showAnnotations) {
      context.fillStyle = "#64748b";
      context.font = "18px sans-serif";
      context.textAlign = "center";
      context.fillText(t("noDisplays"), targetCanvas.width / 2, targetCanvas.height / 2);
    }
    return;
  }

  targetCanvas.width = bounds.width;
  targetCanvas.height = bounds.height;
  context.fillStyle = background;
  context.fillRect(0, 0, bounds.width, bounds.height);

  for (const display of state.displays) {
    const x = display.x - bounds.left;
    const y = display.y - bounds.top;
    const choice = state.choices.get(display.connector);
    const entry = choice ? getEntry(choice.imageId) : undefined;
    if (choice && entry?.image) {
      drawImageForMode(context, entry.image, display, bounds, choice.mode);
    } else {
      context.fillStyle = choice ? "#f8e8c6" : "#d7e1ee";
      context.fillRect(x, y, display.width, display.height);
    }
    if (showAnnotations) {
      drawLabel(context, display, x, y, choice);
      context.lineWidth = display.connector === state.targetConnector ? 10 : 4;
      context.strokeStyle = display.connector === state.targetConnector ? "#2563eb" : "#94a3b8";
      context.strokeRect(x + context.lineWidth / 2, y + context.lineWidth / 2,
        display.width - context.lineWidth, display.height - context.lineWidth);
    }
  }
}

function drawCanvas(): void {
  drawScene(canvas, true);
}

function createWallpaperCanvas(): HTMLCanvasElement {
  const wallpaperCanvas = document.createElement("canvas");
  drawScene(wallpaperCanvas, false);
  return wallpaperCanvas;
}

function updateSelectedControls(): void {
  const display = getTargetDisplay();
  const choice = state.targetConnector ? state.choices.get(state.targetConnector) : undefined;
  fitMode.disabled = !display || !choice;
  if (choice) fitMode.value = choice.mode;
  libraryHint.textContent = display
    ? t("assignHint", { connector: display.connector })
    : t("selectDisplay");
}

function renderGallery(): void {
  gallery.replaceChildren();
  gallery.style.setProperty("--thumbnail-size", `${state.thumbnailSize}px`);
  imageCount.textContent = t("imageCount", { count: state.entries.length });
  if (state.entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("dropDirectoryHint");
    gallery.append(empty);
    return;
  }
  for (const entry of state.entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-tile";
    if (state.targetConnector && state.choices.get(state.targetConnector)?.imageId === entry.id) {
      button.classList.add("active");
    }
    const image = document.createElement("img");
    image.src = entry.url;
    image.alt = entry.name;
    const label = document.createElement("span");
    label.textContent = entry.name;
    label.title = entry.name;
    button.append(image, label);
    button.addEventListener("click", () => assignImage(entry.id));
    gallery.append(button);
  }
}

function updateThumbnailSize(value: number): void {
  if (!Number.isInteger(value) || value < 100 || value > 240) {
    throw new Error(`サムネイルサイズが不正です: ${value}`);
  }
  state.thumbnailSize = value;
  thumbnailSizeInput.value = String(value);
  thumbnailSizeValue.value = `${value}px`;
  thumbnailSizeValue.textContent = `${value}px`;
  gallery.style.setProperty("--thumbnail-size", `${value}px`);
}

function updatePreviewHeight(value: number): void {
  if (!Number.isInteger(value) || value < 220 || value > 700) {
    throw new Error(`プレビュー高さが不正です: ${value}`);
  }
  state.previewHeight = value;
  previewHeightInput.value = String(value);
  previewHeightValue.value = `${value}px`;
  previewHeightValue.textContent = `${value}px`;
  canvas.style.setProperty("--preview-height", `${value}px`);
}

function renderDirectoryList(): void {
  directoryList.replaceChildren();
  if (state.directories.length === 0) {
    const empty = document.createElement("span");
    empty.className = "directory-empty";
    empty.textContent = t("noDirectories");
    directoryList.append(empty);
    return;
  }
  for (const directory of state.directories) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = directory;
    label.title = directory;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "directory-remove";
    remove.textContent = t("remove");
    remove.addEventListener("click", () => { void removeDirectory(directory); });
    item.append(label, remove);
    directoryList.append(item);
  }
}

function selectDisplay(connector: string): void {
  if (!state.displays.some((display) => display.connector === connector)) {
    setStatus(`Unknown monitor selected: ${connector}`, true);
    return;
  }
  state.targetConnector = connector;
  updateSelectedControls();
  renderGallery();
  drawCanvas();
}

function assignImage(imageId: number): void {
  if (!state.targetConnector) {
    setStatus(t("selectDisplayFirst"), true);
    return;
  }
  if (!getEntry(imageId)) {
    setStatus(`Image not found: ${imageId}`, true);
    return;
  }
  const current = state.choices.get(state.targetConnector);
  state.choices.set(state.targetConnector, { imageId, mode: current?.mode ?? "fill" });
  saveWallpaperChoices();
  updateSelectedControls();
  renderGallery();
  drawCanvas();
}

function watchImage(entry: ImageEntry): void {
  const image = new Image();
  image.onload = () => { entry.image = image; drawCanvas(); };
  image.onerror = () => setStatus(t("imageLoadError", { name: entry.name }), true);
  image.src = entry.url;
}

function readSavedDirectories(): string[] {
  const raw = localStorage.getItem(DIRECTORY_STORAGE_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`保存済み画像ディレクトリの設定を解析できません: ${String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.some((path) => typeof path !== "string" || path.length === 0)) {
    throw new Error("保存済み画像ディレクトリの設定が不正です");
  }
  return [...new Set(parsed)];
}

function saveDirectories(): void {
  try {
    localStorage.setItem(DIRECTORY_STORAGE_KEY, JSON.stringify(state.directories));
  } catch (error) {
    throw new Error(`画像ディレクトリを保存できません: ${String(error)}`);
  }
}

function readSavedWallpaperChoices(): Map<string, SavedWallpaperChoice> {
  const raw = localStorage.getItem(WALLPAPER_CHOICES_STORAGE_KEY);
  if (raw === null) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`保存済み壁紙設定を解析できません: ${String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("保存済み壁紙設定の形式が不正です");
  }
  const choices = new Map<string, SavedWallpaperChoice>();
  for (const [connector, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`保存済み壁紙設定が不正です: ${connector}`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.path !== "string" || record.path.length === 0 || typeof record.mode !== "string" || !(record.mode in fitLabelKeys)) {
      throw new Error(`保存済み壁紙設定が不正です: ${connector}`);
    }
    choices.set(connector, { path: record.path, mode: record.mode as FitMode });
  }
  return choices;
}

function saveWallpaperChoices(): void {
  const saved: Record<string, SavedWallpaperChoice> = {};
  for (const [connector, choice] of state.choices) {
    const entry = getEntry(choice.imageId);
    if (!entry || !entry.sourceKey.startsWith("directory:")) continue;
    saved[connector] = {
      path: entry.sourceKey.slice("directory:".length),
      mode: choice.mode,
    };
  }
  try {
    localStorage.setItem(WALLPAPER_CHOICES_STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    throw new Error(`壁紙設定を保存できません: ${String(error)}`);
  }
}

function restoreWallpaperChoices(): void {
  const entriesByPath = new Map(
    state.entries
      .filter((entry) => entry.sourceKey.startsWith("directory:"))
      .map((entry) => [entry.sourceKey.slice("directory:".length), entry]),
  );
  for (const [connector, saved] of state.savedChoices) {
    const entry = entriesByPath.get(saved.path);
    if (!entry) continue;
    state.choices.set(connector, { imageId: entry.id, mode: saved.mode });
  }
}

async function loadDirectoryImages(): Promise<void> {
  if (state.directories.length === 0) {
    state.entries = state.entries.filter((entry) => !entry.sourceKey.startsWith("directory:"));
    const availableIds = new Set(state.entries.map((entry) => entry.id));
    for (const [connector, choice] of state.choices) {
      if (!availableIds.has(choice.imageId)) state.choices.delete(connector);
    }
    renderGallery();
    updateSelectedControls();
    drawCanvas();
    return;
  }

  const images = await invoke<DirectoryImage[]>("load_directory_images", { directories: state.directories });
  const previous = new Map(
    state.entries
      .filter((entry) => entry.sourceKey.startsWith("directory:"))
      .map((entry) => [entry.sourceKey, entry]),
  );
  const manualEntries = state.entries.filter((entry) => !entry.sourceKey.startsWith("directory:"));
  const directoryEntries = images.map((image) => {
    const sourceKey = `directory:${image.path}`;
    const entry: ImageEntry = previous.get(sourceKey) ?? {
      id: state.nextImageId++,
      name: image.name,
      sourceKey,
      url: image.dataUrl,
      image: null,
    };
    entry.name = image.name;
    entry.url = image.dataUrl;
    entry.image = null;
    watchImage(entry);
    return entry;
  });
  state.entries = [...manualEntries, ...directoryEntries];
  const availableIds = new Set(state.entries.map((entry) => entry.id));
  for (const [connector, choice] of state.choices) {
    if (!availableIds.has(choice.imageId)) state.choices.delete(connector);
  }
  restoreWallpaperChoices();
  renderGallery();
  updateSelectedControls();
  drawCanvas();
}

async function addDirectories(directories: string[]): Promise<void> {
  const selected = directories.filter((directory) => directory.length > 0);
  if (selected.length === 0) return;
  const previousDirectories = state.directories;
  state.directories = [...new Set([...previousDirectories, ...selected])];
  try {
    await loadDirectoryImages();
  } catch (error) {
    state.directories = previousDirectories;
    throw error;
  }
  saveDirectories();
  renderDirectoryList();
  clearStatus();
}

async function addDroppedDirectories(paths: string[]): Promise<void> {
  directoryLoadingOverlay.hidden = false;
  try {
    await addDirectories(paths);
  } catch (error) {
    setStatus(t("directoryLoadError", { error: String(error) }), true);
  } finally {
    directoryLoadingOverlay.hidden = true;
  }
}

async function registerDirectoryDrop(): Promise<void> {
  await getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type === "drop") {
      void addDroppedDirectories(event.payload.paths);
    }
  });
}

async function removeDirectory(directory: string): Promise<void> {
  try {
    state.directories = state.directories.filter((item) => item !== directory);
    saveDirectories();
    renderDirectoryList();
    await loadDirectoryImages();
  } catch (error) {
    setStatus(t("directoryUpdateError", { directory, error: String(error) }), true);
  }
}

async function chooseDirectories(): Promise<void> {
  try {
    const selected = await open({
      directory: true,
      multiple: true,
      title: t("directoryTitle"),
    });
    if (selected === null) return;
    await addDirectories(Array.isArray(selected) ? selected : [selected]);
  } catch (error) {
    setStatus(t("directoryLoadError", { error: String(error) }), true);
  }
}

async function restoreDirectories(): Promise<void> {
  try {
    state.directories = readSavedDirectories();
    renderDirectoryList();
    await loadDirectoryImages();
  } catch (error) {
    setStatus(t("savedDirectoryError", { error: String(error) }), true);
  }
}

function handleCanvasClick(event: MouseEvent): void {
  const bounds = getBounds();
  if (!bounds) return;
  const rect = canvas.getBoundingClientRect();
  const sourceRatio = canvas.width / canvas.height;
  const boxRatio = rect.width / rect.height;
  const renderedWidth = boxRatio > sourceRatio ? rect.height * sourceRatio : rect.width;
  const renderedHeight = boxRatio > sourceRatio ? rect.height : rect.width / sourceRatio;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const localX = event.clientX - rect.left - offsetX;
  const localY = event.clientY - rect.top - offsetY;
  if (localX < 0 || localY < 0 || localX >= renderedWidth || localY >= renderedHeight) return;
  const x = localX * canvas.width / renderedWidth;
  const y = localY * canvas.height / renderedHeight;
  const display = state.displays.find((item) => {
    const left = item.x - bounds.left;
    const top = item.y - bounds.top;
    return x >= left && x < left + item.width && y >= top && y < top + item.height;
  });
  if (display) selectDisplay(display.connector);
}

async function loadDisplays(): Promise<void> {
  try {
    state.displays = await invoke<Display[]>("get_displays");
    const primary = state.displays.find((display) => display.primary);
    if (!state.targetConnector || !state.displays.some((display) => display.connector === state.targetConnector)) {
      state.targetConnector = primary?.connector ?? state.displays[0]?.connector ?? null;
    }
  } catch (error) {
    state.displays = [];
    state.targetConnector = null;
    setStatus(String(error), true);
  }
  updateSelectedControls();
  drawCanvas();
}

function canvasToBlob(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    sourceCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unable to convert Canvas to PNG")), "image/png");
  });
}

async function applyWallpaper(): Promise<void> {
  if (state.displays.length === 0) {
    setStatus(t("noMonitor"), true);
    return;
  }
  const missing = state.displays.filter((display) => !state.choices.has(display.connector));
  if (missing.length > 0) {
    setStatus(t("unselectedImages", { connectors: missing.map((display) => display.connector).join(", ") }), true);
    return;
  }
  const loading = state.displays.filter((display) => {
    const choice = state.choices.get(display.connector);
    return !choice || !getEntry(choice.imageId)?.image;
  });
  if (loading.length > 0) {
    setStatus(t("loadingImages", { connectors: loading.map((display) => display.connector).join(", ") }), true);
    return;
  }
  applyButton.disabled = true;
  try {
    const wallpaperCanvas = createWallpaperCanvas();
    const blob = await canvasToBlob(wallpaperCanvas);
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    await invoke<string>("apply_wallpaper", {
      png: bytes,
      width: wallpaperCanvas.width,
      height: wallpaperCanvas.height,
    });
  } catch (error) {
    setStatus(String(error), true);
  } finally {
    applyButton.disabled = false;
  }
}

canvas.addEventListener("click", handleCanvasClick);
refreshButton.addEventListener("click", () => { void loadDisplays(); });
applyButton.addEventListener("click", () => { void applyWallpaper(); });
addFolderButton.addEventListener("click", () => { void chooseDirectories(); });
fitMode.addEventListener("change", () => {
  if (!state.targetConnector) return;
  const choice = state.choices.get(state.targetConnector);
  const mode = fitMode.value as FitMode;
  if (!choice || !(mode in fitLabelKeys)) return;
  state.choices.set(state.targetConnector, { ...choice, mode });
  saveWallpaperChoices();
  drawCanvas();
});
thumbnailSizeInput.addEventListener("input", () => {
  updateThumbnailSize(Number(thumbnailSizeInput.value));
});
previewHeightInput.addEventListener("input", () => {
  updatePreviewHeight(Number(previewHeightInput.value));
});
languageSelect.addEventListener("change", () => {
  try {
    setLanguage(languageSelect.value as Language);
  } catch (error) {
    setStatus(`Unable to change language: ${String(error)}`, true);
  }
});
try {
  currentLanguage = readSavedLanguage();
} catch (error) {
  setStatus(`Unable to restore language preference: ${String(error)}`, true);
}
applyLanguage();
renderGallery();
updateThumbnailSize(state.thumbnailSize);
updatePreviewHeight(state.previewHeight);
renderDirectoryList();
try {
  state.savedChoices = readSavedWallpaperChoices();
} catch (error) {
  setStatus(`Unable to restore saved wallpaper settings: ${String(error)}`, true);
}
updateSelectedControls();
drawCanvas();
void loadDisplays();
void restoreDirectories();
void registerDirectoryDrop().catch((error) => {
  setStatus(`Unable to enable directory drag and drop: ${String(error)}`, true);
});
