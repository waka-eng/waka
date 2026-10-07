import XCTest

/// Exercises the installed M1 app through Apple's native UI test driver.
/// No login, provider request or other application's data is used.
@MainActor
final class FoundationUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "im.waka.app.dev")

    private func open(_ raw: String) {
        app.open(URL(string: raw)!)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let systemOpen = springboard.alerts.buttons["Open"]
        if systemOpen.waitForExistence(timeout: 2) { systemOpen.tap() }
        let appOpen = app.alerts.buttons["Open"]
        if appOpen.exists { appOpen.tap() }
    }
    private func reportContains(_ text: String) -> Bool {
        let condition = NSPredicate(format: "label CONTAINS %@", text)
        return app.webViews.staticTexts.matching(condition).firstMatch.waitForExistence(timeout: 20)
    }
    func testProtectedStorageFilesAndCallbackSurviveRelaunch() {
        continueAfterFailure = false
        open("im.waka.app.dev://diagnostics/check?phase=write")
        XCTAssertTrue(reportContains("\"secureWrite\": true"))
        XCTAssertTrue(reportContains("\"fileWrite\": true"))
        let field = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "callbackFixture")).firstMatch.label
        let pattern = "im\\.waka\\.app\\.dev://auth/callback\\?code=synthetic_authorization_code&state=[A-Za-z0-9_-]+"
        let expression = try! NSRegularExpression(pattern: pattern)
        let match = expression.firstMatch(in: field, range: NSRange(field.startIndex..., in: field))
        XCTAssertNotNil(match)
        let callback = String(field[Range(match!.range, in: field)!])
        app.terminate()
        open("im.waka.app.dev://diagnostics/check?phase=read")
        XCTAssertTrue(reportContains("\"secureRead\": true"))
        XCTAssertTrue(reportContains("\"fileRead\": true"))
        open(callback)
        XCTAssertTrue(reportContains("\"callbackAccepted\": true"))
        XCTAssertTrue(reportContains("\"pendingRemoved\": true"))
        open(callback)
        XCTAssertTrue(reportContains("\"callbackAccepted\": false"))
        open("im.waka.app.dev://diagnostics/check?phase=cleanup")
        XCTAssertTrue(reportContains("\"secureRemoved\": true"))
        open("im.waka.app.dev://navigate/login")
        XCTAssertTrue(app.webViews.staticTexts["Welcome back."].waitForExistence(timeout: 15))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "M1 iOS shared sign-in screen"; screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
