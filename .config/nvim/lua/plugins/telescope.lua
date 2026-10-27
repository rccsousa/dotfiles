return {
  {
    "nvim-telescope/telescope.nvim",
    cmd = "Telescope",
    dependencies = {
      "nvim-lua/plenary.nvim",
      {
        "nvim-telescope/telescope-fzf-native.nvim",
        build = "make",
        cond = function() return vim.fn.executable("make") == 1 end,
      },
    },
    keys = {
      { "<leader>ff", function() require("telescope.builtin").find_files() end, desc = "Find files" },
      { "<leader>fg", function() require("telescope.builtin").live_grep() end, desc = "Live grep" },
      { "<leader>fb", function() require("telescope.builtin").buffers() end, desc = "Buffers" },
      { "<leader>fh", function() require("telescope.builtin").help_tags() end, desc = "Help tags" },
      { "<leader>fr", function() require("telescope.builtin").oldfiles() end, desc = "Recent files" },
      { "<leader>fw", function() require("telescope.builtin").live_grep() end, desc = "Live grep (word)" },
      { "<leader>fW", function()
        local w = vim.fn.expand("<cword>")
        if w == "" or w:match("^%s*$") then
          vim.notify("No word under cursor", vim.log.levels.WARN)
          return
        end
        require("telescope.builtin").grep_string({ search = w, word_match = "-w" })
      end, desc = "Grep whole word under cursor" },
      { "<leader>fW", mode = "v", function()
        local s = vim.fn.getregion(vim.fn.getpos("v"), vim.fn.getpos("."), { type = vim.fn.mode() })
        local q = table.concat(s, "\n")
        if q == "" then return end
        require("telescope.builtin").grep_string({ search = q })
      end, desc = "Grep visual selection" },
      { "<leader>fd", function() require("telescope.builtin").diagnostics() end, desc = "Diagnostics" },
      { "<leader>fs", function() require("telescope.builtin").lsp_document_symbols() end, desc = "Doc symbols" },
      { "<leader>fk", function() require("telescope.builtin").keymaps() end, desc = "Keymaps" },
    },
    config = function()
      local telescope = require("telescope")
      telescope.setup({
        defaults = {
          path_display = { "truncate" },
          vimgrep_arguments = {
            "rg",
            "--color=never",
            "--no-heading",
            "--with-filename",
            "--line-number",
            "--column",
            "--smart-case",
            "--max-filesize=1M",
            "--glob=!**/.git/*",
            "--glob=!**/.claude/*",
            "--glob=!**/.cursor/*",
            "--glob=!**/.aider*",
            "--glob=!**/CLAUDE.md",
            "--glob=!**/AGENTS.md",
            "--glob=!**/.DS_Store",
          },
          file_ignore_patterns = {
            "%.git/",
            "%.claude/",
            "%.cursor/",
            "%.aider",
            "CLAUDE%.md$",
            "AGENTS%.md$",
            "node_modules/",
            "%.lock$",
            "package%-lock%.json$",
            "yarn%.lock$",
            "pnpm%-lock%.yaml$",
            "bun%.lockb$",
            "dist/",
            "build/",
            "target/",
            "%.next/",
            "%.cache/",
            "vendor/",
            "%.min%.js$",
            "%.min%.css$",
            "%.map$",
          },
          mappings = {
            i = {
              ["<C-j>"] = "move_selection_next",
              ["<C-k>"] = "move_selection_previous",
            },
          },
        },
        pickers = {
          find_files = {
            find_command = {
              "rg", "--files",
              "--glob=!**/.git/*",
              "--glob=!**/.claude/*",
              "--glob=!**/.cursor/*",
              "--glob=!**/node_modules/*",
              "--glob=!**/CLAUDE.md",
              "--glob=!**/AGENTS.md",
            },
          },
          live_grep = {
            additional_args = function() return { "--max-filesize=1M" } end,
          },
          grep_string = {
            additional_args = function() return { "--max-filesize=1M" } end,
          },
        },
        extensions = {
          fzf = {
            fuzzy = true,
            override_generic_sorter = true,
            override_file_sorter = true,
            case_mode = "smart_case",
          },
        },
      })
      pcall(telescope.load_extension, "fzf")
    end,
  },
}
