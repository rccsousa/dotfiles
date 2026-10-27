return {
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    opts = {
      preset = "modern",
      delay = 300,
      spec = {
        { "<leader>f", group = "find" },
        { "<leader>c", group = "code" },
        { "<leader>r", group = "rename/refactor" },
        { "<leader>b", group = "buffer" },
        { "<leader>s", group = "split/session" },
        { "<leader>h", group = "git hunk" },
        { "<leader>x", group = "trouble" },
        { "<leader>q", group = "quit/session" },
      },
    },
    keys = {
      {
        "<leader>?",
        function() require("which-key").show({ global = false }) end,
        desc = "Buffer keymaps",
      },
    },
  },
}
