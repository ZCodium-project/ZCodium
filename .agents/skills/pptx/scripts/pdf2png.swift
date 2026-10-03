import Foundation
import CoreGraphics
import ImageIO

func printUsage() {
    let usage = """
    Usage: pdf2png <pdf_path> <output_dir> [--pages <spec>] [--scale <factor>]

    Arguments:
      pdf_path    Path to the PDF file
      output_dir  Directory to save PNG files

    Options:
      --pages     Page specification (default: "1")
                  Examples: "1", "1,3,5", "2-5", "all"
      --scale     Rendering scale factor (default: 2.0)

    Output:
      Creates slide-01.png, slide-02.png, etc. in the output directory.
      Prints each output file path to stdout.
      Exits with code 0 on success, 1 on error.
    """
    fputs(usage, stderr)
}

func parsePages(_ spec: String, totalPages: Int) -> [Int] {
    let trimmed = spec.trimmingCharacters(in: .whitespaces)

    if trimmed.lowercased() == "all" {
        return Array(1...totalPages)
    }

    var pages: [Int] = []
    let parts = trimmed.split(separator: ",")

    for part in parts {
        let value = part.trimmingCharacters(in: .whitespaces)
        if value.contains("-") {
            let range = value.split(separator: "-")
            if range.count == 2,
               let start = Int(range[0].trimmingCharacters(in: .whitespaces)),
               let end = Int(range[1].trimmingCharacters(in: .whitespaces)) {
                let boundedStart = max(1, min(start, totalPages))
                let boundedEnd = max(1, min(end, totalPages))
                if boundedStart <= boundedEnd {
                    pages.append(contentsOf: boundedStart...boundedEnd)
                }
            }
        } else if let page = Int(value) {
            if page >= 1 && page <= totalPages {
                pages.append(page)
            } else {
                fputs("Warning: page \(page) out of range (1-\(totalPages)), skipping\n", stderr)
            }
        }
    }

    var seen = Set<Int>()
    return pages.filter { seen.insert($0).inserted }
}

func renderPage(pdf: CGPDFDocument, pageNum: Int, outputPath: String, scale: CGFloat) -> Bool {
    guard let page = pdf.page(at: pageNum) else {
        fputs("Error: cannot access page \(pageNum)\n", stderr)
        return false
    }

    let mediaBox = page.getBoxRect(.mediaBox)
    let width = Int(mediaBox.width * scale)
    let height = Int(mediaBox.height * scale)

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        fputs("Error: cannot create graphics context for page \(pageNum)\n", stderr)
        return false
    }

    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))

    context.scaleBy(x: scale, y: scale)
    context.drawPDFPage(page)

    guard let image = context.makeImage() else {
        fputs("Error: cannot create image from context for page \(pageNum)\n", stderr)
        return false
    }

    let url = URL(fileURLWithPath: outputPath)
    guard let destination = CGImageDestinationCreateWithURL(
        url as CFURL,
        "public.png" as CFString,
        1,
        nil
    ) else {
        fputs("Error: cannot create image destination at \(outputPath)\n", stderr)
        return false
    }

    CGImageDestinationAddImage(destination, image, nil)

    if !CGImageDestinationFinalize(destination) {
        fputs("Error: failed to write PNG at \(outputPath)\n", stderr)
        return false
    }

    return true
}

func main() -> Int32 {
    let args = CommandLine.arguments

    if args.count < 3 {
        printUsage()
        return 1
    }

    let pdfPath = args[1]
    let outputDir = args[2]

    var pageSpec = "1"
    var scale: CGFloat = 2.0

    var index = 3
    while index < args.count {
        switch args[index] {
        case "--pages":
            if index + 1 < args.count {
                pageSpec = args[index + 1]
                index += 2
            } else {
                fputs("Error: --pages requires a value\n", stderr)
                return 1
            }
        case "--scale":
            if index + 1 < args.count, let parsedScale = Double(args[index + 1]) {
                scale = CGFloat(parsedScale)
                index += 2
            } else {
                fputs("Error: --scale requires a numeric value\n", stderr)
                return 1
            }
        default:
            fputs("Unknown option: \(args[index])\n", stderr)
            printUsage()
            return 1
        }
    }

    let pdfURL = URL(fileURLWithPath: pdfPath)
    guard let pdf = CGPDFDocument(pdfURL as CFURL) else {
        fputs("Error: cannot open PDF file: \(pdfPath)\n", stderr)
        return 1
    }

    let totalPages = pdf.numberOfPages
    if totalPages == 0 {
        fputs("Error: PDF has no pages\n", stderr)
        return 1
    }

    fputs("PDF has \(totalPages) page(s)\n", stderr)

    let pages = parsePages(pageSpec, totalPages: totalPages)
    if pages.isEmpty {
        fputs("Error: no valid pages to render from spec '\(pageSpec)' (total: \(totalPages))\n", stderr)
        return 1
    }

    let fileManager = FileManager.default
    if !fileManager.fileExists(atPath: outputDir) {
        do {
            try fileManager.createDirectory(atPath: outputDir, withIntermediateDirectories: true)
        } catch {
            fputs("Error: cannot create output directory: \(error)\n", stderr)
            return 1
        }
    }

    var success = true
    for pageNum in pages {
        let fileName = String(format: "slide-%02d.png", pageNum)
        let outputPath = (outputDir as NSString).appendingPathComponent(fileName)

        if renderPage(pdf: pdf, pageNum: pageNum, outputPath: outputPath, scale: scale) {
            print(outputPath)
        } else {
            success = false
        }
    }

    return success ? 0 : 1
}

exit(main())
