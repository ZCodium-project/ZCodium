import type { ZCodeCopy } from "../types.js";

export const faIR: ZCodeCopy = {
  locale: "fa-IR",
  cli: {
    errors: {
      localeUnsupported: (value) =>
        `مقدار --locale پشتیبانی نمی‌شود: ${value}. زبان‌های پشتیبانی‌شده: en-US، zh-CN، fa-IR، auto.`,
    },
    help: (version) => `zcode ${version}

طرز استفاده:
  zcode [command] [options]

بدون هیچ دستوری، zcode رابط ترمینالی تمام‌صفحه (TUI) را باز می‌کند.

دستورها:
  app-server اجرای سرور app استاندارد io مبتنی بر ZCode Protocol
  commands   فهرست دستورهای اسلش سفارشی (\`commands list\`)
  doctor     بررسی فرضیات runtime و بسته‌بندی
  login [zai|bigmodel]  ورود از طریق مجوزدهی مرورگر
  logout     حذف اطلاعات ورود مشترک Z.AI
  plugins    مدیریت افزونه‌ها و بازار افزونه‌ها (\`plugins list|install|uninstall|enable|disable|update|validate|marketplace ...\`؛ نام مستعار: plugin)
  skills     فهرست مهارت‌های محلی (\`skills list\`)
  tui        باز کردن رابط ترمینالی
  version    نمایش نسخه CLI

گزینه‌ها:
  -h, --help       نمایش راهنما
  -v, --version    نمایش نسخه
  -p, --prompt <text>  اجرای یک پرامپت بدون باز کردن TUI
  --enable-workflow  فعال‌سازی گردش‌کارهای پویا برای --prompt یا --target (پیش‌فرض: غیرفعال)
  --memory-bench   همراه --prompt، استخراج خودکار حافظه را فعال می‌کند و پیش از خروج منتظر می‌ماند (نیازمند فعال بودن حافظه)
  --browser-use <mode> فعال‌سازی بک‌اند Browser Use (پشتیبانی‌شده: headless)
  --surface <surface>  سطح نمایش برای پرامپت‌های headless و app-server: terminal یا desktop
  --browser-executable <path> مسیر اجرایی Chrome/Chromium برای Browser Use در حالت headless
  --attach <path>  پیوست یک فایل محلی به --prompt؛ برای چند فایل تکرار شود
  --cwd <path>     اجرای این دستور از پوشه داده‌شده
  --disallowed-tools, --disallowedTools <tools...>
    حذف کامل ابزارها فقط برای اجرای فعلی پرامپت/TUI؛ تنظیمات ذخیره‌شده تغییر نمی‌کند.
    نام ابزارها با کاما یا فاصله جدا شود، مثلاً "Bash Edit".
    الگوی "Bash(git *)" کل Bash را حذف می‌کند؛ تطبیق بر اساس محتوای دستور انجام نمی‌شود.
  --force-mcs      اجبار پیش‌نمایش سیستمی میانه‌گفتگو برای فراهم‌کننده‌های Anthropic
  --locale <locale>  زبان رابط کاربری: en-US، zh-CN، fa-IR یا auto
  --mode <mode>    حالت مجوز برای پرامپت‌ها: build، edit، plan یا yolo (پیش‌فرض yolo برای --prompt)
  --resume <sessionId>  ازسرگیری نشست ذخیره‌شده با شناسه sessionId (sess_...)
  --target <text>  اجرای هدف یا تنظیم هدف نشست در حالت headless
  --target-replace جایگزینی هدف نشستی که پیش‌تر با --target تنظیم شده است
  -c, --continue        ازسرگیری آخرین نشست پوشه جاری
  --json           چاپ JSON قابل‌پردازش ماشین در دستورهای پشتیبانی‌شده
  --no-browser     چاپ نشانی OAuth بدون باز کردن مرورگر
  --no-color       غیرفعال کردن رنگ‌های ANSI
  --verbose        چاپ جزئیات تشخیصی بیشتر

دستورهای اسلش:
  /help [command]       نمایش راهنمای دستورهای اسلش
  /login                انتخاب ورود Z.AI یا BigModel از طریق مرورگر
  /logout               حذف اطلاعات ورود مشترک Z.AI
  /compact [instructions]  فشرده‌سازی گفت‌وگوی فعلی
  /expert [status|resume|stop|<task>]  اجرا یا مدیریت گردش‌کار متخصص
  /dwf [list|cancel|resume]  فهرست، لغو یا ازسرگیری اجراهای گردش‌کار پویا
  /fork [latest|checkpointId]  ایجاد نشست جدید از یک نقطه بازیابی فضای کاری
  /mcp [list|status|connect|disconnect]  نمایش یا مدیریت سرورهای MCP
  /mode [mode]          نمایش یا تغییر حالت مجوز: build، edit، plan یا yolo
  /model [id]           نمایش یا تغییر مدل نشست جاری
  /new                  شروع نشست تازه در TUI
  /resume [sessionId]   ازسرگیری نشست با شناسه sessionId؛ بدون شناسه، آخرین نشست پوشه جاری
  /rewind [latest|checkpointId]  نمایش آخرین نقطه بازیابی یا بازگردانی فایل‌های فضای کاری
  /skill [name] [task]  فهرست مهارت‌ها، یا اجبار پرامپت بعدی به بارگذاری یکی از آن‌ها
  /goal [action]        نمایش یا تنظیم هدف نشست جاری
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
