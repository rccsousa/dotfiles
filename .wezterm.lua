local wezterm = require("wezterm")

local config = wezterm.config_builder()

config.color_scheme = "Afterglow"
config.font = wezterm.font("JetBrains Mono")
config.font_size = 12.0

config.hide_tab_bar_if_only_one_tab = false

wezterm.on("update-right-status", function(window, pane)
	window:set_right_status("pane: " .. pane:pane_id())
end)

config.enable_kitty_keyboard = true

config.keys = {
	{ key = "/", mods = "SHIFT|CTRL", action = wezterm.action.QuickSelect },
	{ key = "LeftArrow", mods = "OPT", action = wezterm.action.SendString("\x1bb") },
	{ key = "RightArrow", mods = "OPT", action = wezterm.action.SendString("\x1bf") },
	{ key = "W", mods = "CMD|SHIFT", action = wezterm.action.SplitVertical {domain = 'CurrentPaneDomain'} },	
	{ key = "D", mods = "CMD|SHIFT", action = wezterm.action.SplitHorizontal {domain = 'CurrentPaneDomain'} },
	{ key = "K", mods = "CMD|SHIFT", action = wezterm.action.AdjustPaneSize {'Up', 5} },
	{ key = "J", mods = "CMD|SHIFT", action = wezterm.action.AdjustPaneSize {'Down', 5} },
	{ key = "H", mods = "CMD|SHIFT", action = wezterm.action.AdjustPaneSize {'Left', 5} },
	{ key = "L", mods = "CMD|SHIFT", action = wezterm.action.AdjustPaneSize {'Right', 5} },
	{ key = "J", mods = "CTRL|SHIFT", action = wezterm.action.ActivatePaneDirection 'Down'  },
	{ key = "K", mods = "CTRL|SHIFT", action = wezterm.action.ActivatePaneDirection 'Up'  },
	{ key = "L", mods = "CTRL|SHIFT", action = wezterm.action.ActivatePaneDirection 'Right'  },
	{ key = "H", mods = "CTRL|SHIFT", action = wezterm.action.ActivatePaneDirection 'Left'  },
}

return config
