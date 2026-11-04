// 用 macOS Vision 识别一张图片里的文字，逐行输出（简体中文 + 英文，精确模式，不做语言纠正）。
// cover_dates_build.py 编译后调用：swiftc -O cover_ocr.swift -o <工作目录>/cover_ocr
import Foundation
import Vision

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let handler = VNImageRequestHandler(url: url)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = false
try handler.perform([req])
for obs in req.results ?? [] {
    if let top = obs.topCandidates(1).first { print(top.string) }
}
