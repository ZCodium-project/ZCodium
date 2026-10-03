using DocumentFormat.OpenXml.Wordprocessing;

// Modified by ZCode: 增加 ContainsCjk / ApplyEastAsiaFontIfCjk，供 create 的 JSON 内容分支指定东亚字体。

namespace MiniMaxAIDocx.Core.Typography;

/// <summary>
/// CJK mixed typography helpers for East Asian font and paragraph configuration.
/// </summary>
public static class CjkHelper
{
    public const string DefaultSimplifiedChinese = "SimSun";
    public const string DefaultJapanese = "MS Mincho";
    public const string DefaultKorean = "Batang";

    /// <summary>
    /// 设置 run 上的东亚字体。
    /// </summary>
    public static void SetEastAsiaFont(RunProperties rPr, string fontName)
    {
        var fonts = rPr.RunFonts;
        if (fonts == null)
        {
            fonts = new RunFonts();
            rPr.RunFonts = fonts;
        }
        fonts.EastAsia = fontName;
    }

    /// <summary>
    /// 判断文本是否含 CJK 字符。
    /// 修复依据：create 的 JSON 内容分支此前完全没写 w:eastAsia，中文只能靠阅读器字体回退，
    /// 公文/中英混排时行高与断行会随机器上的字体而变。是否需要东亚字体取决于实际字符，
    /// 因此只在确有 CJK 时施加，避免把纯西文文档的西文槽也换成 SimSun。
    /// </summary>
    public static bool ContainsCjk(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return false;
        }

        foreach (var c in text)
        {
            if ((c >= 0x4E00 && c <= 0x9FFF)     // CJK 统一表意文字
                || (c >= 0x3400 && c <= 0x4DBF) // 扩展 A
                || (c >= 0xF900 && c <= 0xFAFF) // 兼容表意文字
                || (c >= 0x3040 && c <= 0x30FF) // 日文假名
                || (c >= 0xAC00 && c <= 0xD7AF) // 韩文谚文
                || (c >= 0x3000 && c <= 0x303F)) // CJK 标点
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// 文本含 CJK 时才在 run 上设置东亚字体；纯西文保持调用方既有设置。
    /// </summary>
    public static void ApplyEastAsiaFontIfCjk(RunProperties rPr, string? text, string fontName = DefaultSimplifiedChinese)
    {
        if (!ContainsCjk(text))
        {
            return;
        }

        SetEastAsiaFont(rPr, fontName);
    }

    /// <summary>
    /// Configures CJK-appropriate paragraph properties.
    /// </summary>
    public static void ConfigureCjkParagraph(ParagraphProperties pPr)
    {
        // Enable word wrap for CJK
        pPr.WordWrap = new WordWrap { Val = true };
        // Allow auto space between CJK and Latin/numbers
        pPr.AutoSpaceDE = new AutoSpaceDE { Val = true };
        pPr.AutoSpaceDN = new AutoSpaceDN { Val = true };
    }
}
