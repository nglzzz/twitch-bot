-- Горячие клавиши для заказа музыки (nglzzz twitch-bot).
-- Установка: OBS → Инструменты → Скрипты → «+» → выберите этот файл.
-- Затем: Настройки → Горячие клавиши → «Музыка: …» — назначьте клавиши.
-- Клавиши глобальные: работают, даже когда OBS свёрнут.
-- Запросы отправляются через curl (есть в Linux, macOS и Windows 10+).

obs = obslua

local DEFAULT_BASE_URL = "__BASE_URL__"
local DEFAULT_TOKEN = "__TOKEN__"

local base_url = DEFAULT_BASE_URL
local token = DEFAULT_TOKEN
local hotkeys = {}

local ACTIONS = {
  { id = "nglzzz_music_toggle", label = "Музыка: пауза / играть", action = "toggle" },
  { id = "nglzzz_music_skip", label = "Музыка: следующий трек", action = "skip" },
}

local IS_WINDOWS = package.config:sub(1, 1) == "\\"

-- В командную строку попадают только безопасные символы.
local function safe_url(value)
  return value ~= "" and value:match("^https?://[%w%.%-_:/]+$") ~= nil
end

local function safe_token(value)
  return value ~= "" and value:match("^[%w%-_]+$") ~= nil
end

local function send(action)
  if not safe_url(base_url) or not safe_token(token) then
    obs.script_log(obs.LOG_WARNING, "Музыка: проверьте адрес сайта и токен дока в настройках скрипта")
    return
  end
  local url = base_url:gsub("/+$", "") .. "/api/music/control"
  local cmd
  if IS_WINDOWS then
    cmd = 'start "" /b curl -s -m 5 -X POST -H "Content-Type: application/json" -H "X-Music-Token: ' .. token
      .. '" -d "{\\"action\\":\\"' .. action .. '\\"}" "' .. url .. '" >NUL 2>&1'
  else
    cmd = "curl -s -m 5 -X POST -H 'Content-Type: application/json' -H 'X-Music-Token: " .. token
      .. "' -d '{\"action\":\"" .. action .. "\"}' '" .. url .. "' >/dev/null 2>&1 &"
  end
  os.execute(cmd)
end

function script_description()
  return "Горячие клавиши для заказа музыки: пауза / играть и следующий трек.\n"
    .. "Назначьте клавиши в Настройки → Горячие клавиши → «Музыка: …».\n"
    .. "Если перевыпустили ссылку дока в админке — вставьте новый токен ниже."
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_text(props, "base_url", "Адрес сайта", obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props, "token", "Токен дока", obs.OBS_TEXT_PASSWORD)
  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_string(settings, "base_url", DEFAULT_BASE_URL)
  obs.obs_data_set_default_string(settings, "token", DEFAULT_TOKEN)
end

function script_update(settings)
  base_url = obs.obs_data_get_string(settings, "base_url")
  token = obs.obs_data_get_string(settings, "token")
end

function script_load(settings)
  for _, item in ipairs(ACTIONS) do
    local action = item.action
    local id = obs.obs_hotkey_register_frontend(item.id, item.label, function(pressed)
      if pressed then send(action) end
    end)
    hotkeys[item.id] = id
    local saved = obs.obs_data_get_array(settings, item.id)
    obs.obs_hotkey_load(id, saved)
    obs.obs_data_array_release(saved)
  end
end

function script_save(settings)
  for _, item in ipairs(ACTIONS) do
    local saved = obs.obs_hotkey_save(hotkeys[item.id])
    obs.obs_data_set_array(settings, item.id, saved)
    obs.obs_data_array_release(saved)
  end
end
