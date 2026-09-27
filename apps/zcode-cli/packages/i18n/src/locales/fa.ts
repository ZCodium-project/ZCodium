import type { ZCodeCopy } from "../types.js";

export const faIR: ZCodeCopy = {
  locale: "fa-IR",
  cli: {
    errors: {
      localeUnsupported: (value) =>
        `مقدار --locale پشتیبانی نمی‌شود: ${value}. زبان‌های پشتیبانی‌شده: en-US، zh-CN، fa-IR، auto.`,
    },
    help: (version) => `zcode ${version}

用法:
  zcode [command] [options]

Without a command, zcode opens the full-screen TUI.

Commands:
  app-server Run the ZCode Protocol stdio app server
  commands   List custom slash commands (\`commands list\`)
  doctor     Inspect runtime and packaging assumptions
  login [zai|bigmodel]  Sign in through browser authorization
  logout     Remove the shared Z.AI login credentials
  plugins    Manage plugins and marketplaces (\`plugins list|install|uninstall|enable|disable|update|validate|marketplace ...\`; alias: plugin)
  skills     List local skills (\`skills list\`)
  tui        Open the terminal UI
  version    Print the CLI version

Options:
  -h, --help       Show help
  -v, --version    Show version
  -p, --prompt <text>  Run a single prompt without opening the TUI
  --enable-workflow  Enable dynamic workflows for --prompt or --target (default: off)
  --memory-bench   With --prompt, enable automatic Memory extraction and wait before exiting (requires Memory enabled)
  --browser-use <mode> Enable Browser Use backend (supported: headless)
  --surface <surface>  Presentation surface for headless prompts/app-server: terminal or desktop
  --browser-executable <path> Chrome/Chromium executable for headless Browser Use
  --attach <path>  Attach a local file to --prompt; repeat for multiple files
  --cwd <path>     Run this command from the given directory
  --disallowed-tools, --disallowedTools <tools...>
    Remove whole tools for this prompt/TUI run only; saved settings are unchanged.
    Comma or space-separated tool names, e.g. "Bash Edit".
    "Bash(git *)" removes all of Bash; command patterns are not matched.
  --force-mcs      Force mid-conversation system projection for Anthropic providers
  --locale <locale>  UI locale: en-US, zh-CN, fa-IR, or auto
  --mode <mode>    Permission mode for prompts: build, edit, plan, or yolo (default: yolo for --prompt)
  --resume <sessionId>  Resume a persisted session by sessionId (sess_...)
  --target <text>  Run or set the session goal in headless mode
  --target-replace Replace any existing session goal set by --target
  -c, --continue        Resume the latest session for the current directory
  --json           Print machine-readable JSON where supported
  --no-browser     Print the OAuth URL without opening a browser
  --no-color       Disable ANSI colors
  --verbose        Print extra diagnostic detail

Slash Commands:
  /help [command]       Show slash command help
  /login                Choose Z.AI or BigModel browser login
  /logout               Remove the shared Z.AI login credentials
  /compact [instructions]  Compact the current conversation
  /expert [status|resume|stop|<task>]  Run or manage the expert workflow
  /dwf [list|cancel|resume]  List, cancel, or resume dynamic workflow runs
  /fork [latest|checkpointId]  Fork a new session from a workspace checkpoint
  /mcp [list|status|connect|disconnect]  Show or manage MCP servers
  /mode [mode]          Show or switch permission mode: build, edit, plan, or yolo
  /model [id]           Show or switch the current session model
  /new                  Start a fresh session in the TUI
  /resume [sessionId]   Resume a session by sessionId; omit it for latest in cwd
  /rewind [latest|checkpointId]  Show latest checkpoint or restore workspace files
  /skill [name] [task]  List skills, or force the next prompt to load one
  /goal [action]        Show or set the current session goal
`,
  },
  tui: {
    copy: {
      copied: "متن انتخاب‌شده در کلیپ‌بورد کپی شد.",
      failed: "کپی متن انتخاب‌شده ممکن نشد.",
      unavailable: "کپی با کلیپ‌بورد متنی در این ترمینال در دسترس نیست.",
    },
    effort: {
      disabled: "غیرفعال",
      enabled: "فعال",
    },
    input: {
      activeStatusHint: "esc برای قطع",
      busyPlaceholder: "برای صف‌شدن ورودی، تایپ کنید",
      placeholder: "پرامپت را تایپ کنید",
      queuedMore: (count) => `+ ${count} مورد دیگر در صف`,
      queuedSubmitHint: "پس از فراخوانی بعدی ابزار ارسال می‌شود.",
      queuedTitle: (count) => ` صف (${count}) `,
      title: "ورودی",
      noHistorySource: "منبع تاریخچه ورودی پیکربندی نشده است.",
      noPreviousInput: "برای این پروژه ورودی قبلی وجود ندارد.",
      restoredPreviousInput: "ورودی قبلی بازیابی شد.",
      restoredPreviousInputWithAttachments: (count) =>
        `ورودی قبلی همراه با ${count} پیوست بازیابی شد.`,
      restorePreviousInputFailed: "بازیابی ورودی قبلی ممکن نشد.",
      typePrompt: "پرسش را تایپ کنید و Enter بزنید.",
    },
    loginRequired: {
      help: "با /model مدل‌ها را ببینید، یا با /login به حساب Coding Plan وصل شوید.",
      message: "هیچ مدلی در دسترس نیست. یک فراهم‌کننده پیکربندی کنید یا با /login وارد شوید.",
      status: "هیچ مدلی در دسترس نیست. یک فراهم‌کننده پیکربندی کنید یا با /login وارد شوید.",
      title: "پیکربندی مدل لازم است",
    },
    loginSetup: {
      emptyMessage: "هیچ گزینه ورودی در دسترس نیست.",
      help: "با Up/Down انتخاب کنید و با Enter تأیید کنید.",
      options: {
        bigmodelApiKey: {
          inputPrimary: "کلید API مربوط به BigModel Coding Plan را وارد کنید",
          inputSecondary: "کلید را اینجا بچسبانید؛ هنگام تایپ پنهان می‌ماند.",
          primary: "کلید API مربوط به BigModel Coding Plan",
          secondary: "چسباندن دستی کلید API مربوط به Coding Plan.",
        },
        bigmodelOauth: {
          pendingPrimary: "در انتظار تأیید BigModel",
          pendingSecondary: "ورود را در مرورگر کامل کنید. تأیید به‌صورت خودکار شناسایی می‌شود.",
          primary: "BigModel Coding Plan",
          secondary: "باز کردن ورود مرورگری؛ تأیید به‌صورت خودکار شناسایی می‌شود.",
        },
        zaiApiKey: {
          inputPrimary: "کلید API مربوط به Z.AI Coding Plan را وارد کنید",
          inputSecondary: "کلید را اینجا بچسبانید؛ هنگام تایپ پنهان می‌ماند.",
          primary: "کلید API مربوط به Z.AI Coding Plan",
          secondary: "چسباندن دستی کلید API مربوط به Coding Plan.",
        },
        zaiOauth: {
          pendingPrimary: "در انتظار تأیید Z.AI",
          pendingSecondary: "ورود را در مرورگر کامل کنید. پس از پایان تأیید ادامه می‌دهم.",
          primary: "Z.AI Coding Plan",
          secondary: "باز کردن ورود مرورگری و ساخت کلید API مربوط به Coding Plan.",
        },
      },
      pending: {
        cancelStatus: "ورود لغو شد. یک روش پیکربندی انتخاب کنید.",
        help: "Esc لغو می‌کند و به انتخاب روش پیکربندی برمی‌گردد.",
        status: "در انتظار تأیید مرورگر...",
      },
      input: {
        cancelStatus: "ورود کلید API لغو شد. یک روش پیکربندی انتخاب کنید.",
        clearStatus: "ورودی کلید API پاک شد.",
        emptyStatus: "کلید API الزامی است.",
        help: "Enter کلید را ذخیره می‌کند. Esc به انتخاب روش پیکربندی برمی‌گردد.",
        placeholder: "کلید API را بچسبانید",
        status: "کلید API را وارد کنید و Enter بزنید.",
        submitStatus: "در حال ذخیره کلید API...",
      },
      prompt: "یک روش ورود یا پیکربندی کلید API را انتخاب کنید.",
      response: "روش پیکربندی فراهم‌کننده Coding Plan را انتخاب کنید.",
      title: "پیکربندی Coding Plan",
    },
    model: {
      requestFailed: (message) => `درخواست مدل ناموفق بود: ${message}`,
      responseReceived: "پاسخ مدل دریافت شد.",
      responseReceivedWithTokens: (tokens) => `پاسخ مدل دریافت شد. ${tokens} توکن.`,
      retryScheduled: ({ attempt, delay, maxAttempts, reason }) =>
        `تلاش مجدد درخواست مدل ${attempt}/${Math.max(1, maxAttempts - 1)} پس از ${delay}: ${reason}`,
      streamStalled: "جریان خروجی مدل متوقف شد.",
    },
    sidebar: {
      subagents: {
        title: "ایجنت‌های فرعی",
        empty: "هنوز ایجنت فرعی‌ای نیست.",
        emptyOutput: "هنوز خروجی‌ای نیست.",
        back: "← گفت‌وگوی اصلی",
        readonly: "فقط‌خواندنی · Esc برای بازگشت",
        loading: "در حال بارگذاری خروجی ایجنت فرعی...",
        unavailable: "خروجی ایجنت فرعی در دسترس نیست.",
        retry: "تلاش دوباره",
        more: "بارگذاری بیشتر",
        pendingMain: "گفت‌وگوی اصلی به ورودی شما نیاز دارد — برای پاسخ برگردید",
        ended: (count) => `پایان‌یافته (${count})`,
        status: {
          running: "در حال اجرا",
          waiting: "در انتظار ورودی",
          blocked: "مسدود",
          success: "کامل شد",
          failed: "ناموفق",
          cancelled: "لغو شد",
          lost: "گم‌شده",
        },
      },
      api: {
        empty: "هنوز فراخوانی API‌ای نیست.",
        model: "مدل",
        more: (count) => `+${count} مورد بیشتر`,
        requests: "درخواست‌ها",
        server: "سرور",
      },
      cache: {
        hit: "hit",
        lastHit: "آخرین hit",
        lastMiss: "آخرین miss",
        readWrite: ({ read, write }) => `${read} خواندن / ${write} نوشتن`,
        total: "مجموع",
      },
      context: {
        cache: "کش",
        cacheReadWrite: "خواندن/نوشتن کش",
        inputOutput: "ورودی/خروجی",
        reason: "استدلال",
        tokens: "توکن‌ها",
        used: "مصرف‌شده",
        window: "پنجره",
      },
      modifiedFiles: {
        empty: "هنوز تغییری در فایل‌ها نیست.",
        more: (count) => `+${count} فایل بیشتر`,
      },
      mcp: {
        empty: "هیچ سرور MCP‌ای پیکربندی نشده است.",
        loadFailed: "وضعیت MCP در دسترس نیست.",
        loading: "در حال بارگذاری وضعیت MCP...",
        more: (count) => `+${count} مورد بیشتر`,
        servers: "سرورها",
        status: {
          connected: "متصل",
          connecting: "در حال اتصال",
          disabled: "غیرفعال",
          disconnected: "قطع‌شده",
          failed: "ناموفق",
          untrusted: "غیرمطمئن",
        },
        summary: ({ connected, total }) => `${connected}/${total} متصل`,
        tools: (count) => `${count} ابزار`,
      },
      request: {
        complete: "کامل",
        error: "خطا",
        errorWithStatus: (statusCode) => `خطا ${statusCode}`,
        pending: "در انتظار",
      },
      status: {
        last: "آخرین",
      },
      run: {
        draft: "پیش‌نویس",
        draftChars: (count) => `${count} نویسه`,
        draftEmpty: "خالی",
        messages: "پیام‌ها",
        mode: "حالت",
        model: "مدل",
        provider: "فراهم‌کننده",
        thought: "تفکر",
        trace: "Trace",
        turn: "نوبت",
        workspace: "فضای کاری",
      },
      sections: {
        apis: "APIها",
        context: "زمینه",
        mcp: "MCP",
        modifiedFiles: "فایل‌های تغییریافته",
        run: "اجرا",
        status: "وضعیت",
        todos: "کارها",
      },
      shellSubtitle: "پوسته OpenTUI",
      title: "نوار کناری",
      todos: {
        empty: "هنوز کاری نیست.",
        more: (count) => `+${count} مورد بیشتر`,
        progress: "پیشرفت",
      },
    },
    status: {
      compactFailed: "فشردن زمینه ناموفق بود.",
      compacted: "گفت‌وگو فشرده شد.",
      compacting: "در حال فشردن زمینه...",
      interruptedStreamDiscarded: "جریان قطع‌شده مدل دور انداخته شد.",
      modelCalling: "در حال فراخوانی مدل...",
      permissionRequested: (toolName) => `درخواست مجوز برای ${toolName}.`,
      permissionResolved: (toolName) => `مجوز ${toolName} بررسی شد.`,
      ready: "آماده.",
      recoveringStream: "در حال بازیابی جریان قطع‌شده مدل...",
      retryingStream: "در حال تلاش مجدد جریان مدل...",
      sessionResumed: "نشست ازسرگرفته شد.",
      targetChanged: (action) => `هدف ${action}.`,
      thinking: "در حال تفکر...",
      toolCompleted: (toolName) => `ابزار ${toolName} کامل شد.`,
      toolFailed: (toolName) => `ابزار ${toolName} ناموفق بود.`,
      toolPending: (toolName) => `ابزار ${toolName} در انتظار است.`,
      toolRunning: (toolName) => `ابزار ${toolName} در حال اجراست.`,
      turnFailed: "این نوبت ناموفق بود.",
    },
    terminal: {
      requiresInteractive: "TUI به یک ترمینال تعاملی نیاز دارد.",
      starting: "در حال راه‌اندازی ZCode... برای خروج Ctrl+C",
    },
    transcript: {
      compact: {
        completed: "زمینه فشرده شد",
        failed: "فشردن زمینه ناموفق بود",
        interrupted: "فشردن زمینه قطع شد",
        retry: (command) => `برای تلاش مجدد ${command} کلید Ctrl-R`,
        retrying: ({ attempt, maxAttempts }) =>
          maxAttempts > 0
            ? `تلاش مجدد فشردن زمینه (${attempt}/${maxAttempts})`
            : "تلاش مجدد فشردن زمینه",
        skipped: "زمینه به‌روز است؛ فشردنی لازم نیست",
        started: "در حال فشردن زمینه",
      },
      roles: {
        agent: "ایجنت",
        system: "سیستم",
        user: "کاربر",
      },
      thought: {
        complete: "تفکر",
        thinking: "در حال تفکر...",
      },
      title: "گفت‌وگو",
      workflow: {
        actors: "عوامل:",
        actorRow: ({ name, status }) => `${name} - ${status}`,
        usage: ({ spentTokens }) => `مصرف: ${spentTokens} توکن`,
        collapsed: ({ label, status, nodesSettled, nodesTotal }) =>
          `گردش کار ${label} - ${status} (${nodesSettled}/${nodesTotal} گام)`,
        error: (message) => `خطا: ${message}`,
        expandHint: "+ برای باز کردن",
        collapseHint: "- برای بستن",
        log: "گزارش:",
        nodes: ({ nodesSettled, nodesTotal }) => `${nodesSettled}/${nodesTotal} گام نهایی شد`,
        result: (preview) => `نتیجه: ${preview}`,
        status: {
          completed: "کامل شد",
          errored: "خطا داد",
          pending: "در انتظار",
          running: "در حال اجرا",
          stopped: "متوقف شد",
        },
        stopReason: {
          user: "توسط شما",
          model: "توسط ایجنت",
          provider: "خطای مدل",
          interrupted: "فرایند خارج شد",
          superseded: "با اجرای اصلاح‌شده جایگزین شد",
        },
        truncated: "(بریده شد — تاریخچه کامل در دفتر رویداد اجرا)",
        interruptedNotice: ({ label, runId }) =>
          `گردش کار ${label} قطع شد و قابل ازسرگیری است: /dwf resume ${runId}`,
      },
    },
    selection: {
      defaultHelp: "Enter انتخاب، Esc لغو",
      disabled: (reason) => ` [غیرفعال: ${reason}]`,
      filterLine: ({ filter, help }) =>
        `پالایه: ${filter || "-"} | ${help ?? "Enter انتخاب، Esc لغو"}`,
      noFilter: "-",
    },
    fileMention: {
      empty: "مسیری در فضای کاری مطابقت ندارد.",
      loading: "در حال بارگذاری مسیرهای فضای کاری...",
      row: ({ path, selected }) => `${selected ? ">" : " "} ${path}`,
      title: "فایل‌ها",
    },
    slash: {
      title: "دستورها",
      row: ({ name, selected, summary }) => `${selected ? ">" : " "} /${name}  ${summary}`,
    },
  },
};
