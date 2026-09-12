const form = document.getElementById("settingsForm");
const aiApiKeyInput = document.getElementById("aiApiKey");
const supadataApiKeyInput = document.getElementById("supadataApiKey");
const customizationPrompt = document.getElementById("customizationPrompt");
const copyCustomizationPromptBtn = document.getElementById(
  "copyCustomizationPromptBtn",
);
const copyStatus = document.getElementById("copyStatus");
const saveStatus = document.getElementById("saveStatus");
const dataStatus = document.getElementById("dataStatus");

document.addEventListener("DOMContentLoaded", loadSettings);
form.addEventListener("submit", saveSettings);
copyCustomizationPromptBtn.addEventListener("click", copyCustomizationPrompt);
document
  .getElementById("clearCacheBtn")
  .addEventListener("click", clearCachedDigests);
document
  .getElementById("clearNotesBtn")
  .addEventListener("click", clearNotes);
document.getElementById("resetBtn").addEventListener("click", resetAllData);

async function loadSettings() {
  const stored = await chrome.storage.local.get(YTD_SETTINGS.STORAGE_KEY);
  const migration = YTD_SETTINGS.migrateLegacyCustom(
    stored[YTD_SETTINGS.STORAGE_KEY],
  );
  const settings = migration.settings;

  aiApiKeyInput.value = settings.aiApiKey;
  supadataApiKeyInput.value = settings.supadataApiKey;
  if (migration.migrated) {
    await chrome.storage.local.set({
      [YTD_SETTINGS.STORAGE_KEY]: settings,
    });
    saveStatus.textContent =
      "已清理旧版自定义服务配置并保留 Supadata 密钥。请重新填写 DeepSeek 密钥。";
  }
}

async function saveSettings(event) {
  event.preventDefault();
  saveStatus.textContent = "正在保存…";

  try {
    const settings = YTD_SETTINGS.normalize({
      aiApiKey: aiApiKeyInput.value,
      supadataApiKey: supadataApiKeyInput.value,
    });

    if (!settings.aiApiKey) {
      throw new Error("请填写 DeepSeek API 密钥。");
    }

    await chrome.storage.local.set({
      [YTD_SETTINGS.STORAGE_KEY]: settings,
    });

    saveStatus.textContent = "设置已保存，重新打开学习侧栏即可使用。";
  } catch (error) {
    saveStatus.textContent = error.message;
  }
}

async function copyCustomizationPrompt() {
  copyStatus.textContent = "正在复制…";
  try {
    await navigator.clipboard.writeText(customizationPrompt.value);
    copyStatus.textContent = "自定义提示词已复制。";
  } catch (_error) {
    copyStatus.textContent =
      "复制失败，请选中提示词手动复制。";
  }
}

async function clearCachedDigests() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith("digest_"));
  if (keys.length) await chrome.storage.local.remove(keys);
  dataStatus.textContent = `已清理 ${keys.length} 个字幕缓存。`;
}

async function clearNotes() {
  await chrome.storage.local.remove("ytd_notes");
  dataStatus.textContent = "已删除全部笔记。";
}

async function resetAllData() {
  const confirmed = window.confirm(
    "确认删除此 Chrome 配置中的密钥、字幕缓存、翻译、词句收藏、笔记与学习记录？",
  );
  if (!confirmed) return;

  await chrome.storage.local.clear();
  await loadSettings();
  dataStatus.textContent = "已清空本扩展的全部本地数据。";
}
