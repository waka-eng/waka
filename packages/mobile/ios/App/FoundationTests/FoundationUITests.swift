import XCTest

/// Exercises the installed M1 app through Apple's native UI test driver.
/// No login, provider request or other application's data is used.
@MainActor
final class FoundationUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "im.waka.app.dev")

    private func open(_ raw: String) {
        app.open(URL(string: raw)!)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        // The OS handoff can be a sheet rather than an XCTest alert.
        let systemOpen = springboard.buttons["Open"]
        if systemOpen.waitForExistence(timeout: 3) { systemOpen.tap() }
        let appOpen = app.buttons["Open"]
        if appOpen.waitForExistence(timeout: 2) { appOpen.tap() }
    }
    private func reportContains(_ text: String) -> Bool {
        let condition = NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", text, text)
        return app.webViews.staticTexts.matching(condition).firstMatch.waitForExistence(timeout: 20)
    }
    func testProtectedStorageFilesAndCallbackSurviveRelaunch() {
        continueAfterFailure = false
        open("im.waka.app.dev://diagnostics/check?phase=write")
        XCTAssertTrue(reportContains("\"secureWrite\": true"))
        XCTAssertTrue(reportContains("\"fileWrite\": true"))
        XCTAssertTrue(reportContains("\"body\": true"))
        XCTAssertTrue(reportContains("\"heading\": true"))
        XCTAssertTrue(reportContains("\"connected\": true"))
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
    func testConnectionFailureBannerAndRealRetry() {
        continueAfterFailure = false
        open("im.waka.app.dev://diagnostics/connection-failure")
        let retry = app.webViews.buttons["Try again"]
        XCTAssertTrue(retry.waitForExistence(timeout: 15))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "M1 iOS simulated connection failure"; screenshot.lifetime = .keepAlways
        add(screenshot)
        retry.tap()
        let disappeared = NSPredicate(format: "exists == false")
        expectation(for: disappeared, evaluatedWith: retry)
        waitForExpectations(timeout: 15)
    }
}

@MainActor
final class AccountsUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "im.waka.app.test")
    private let captureText = "Native capture: I want tools that leave room to think."
    private var capture: XCUIElement { app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "capture inspiration")).firstMatch }
    private var logoutButton: XCUIElement { app.webViews.buttons.matching(NSPredicate(format: "label ==[c] %@", "sign out")).firstMatch }
    private func open(_ path: String) {
        app.open(URL(string: "im.waka.app.test://navigate\(path)")!)
        let systemOpen = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if systemOpen.waitForExistence(timeout: 2) { systemOpen.tap() }
        let appOpen = app.buttons["Open"]
        if appOpen.waitForExistence(timeout: 1) { appOpen.tap() }
    }
    private func signIn(_ address: String) async {
        let email = app.webViews.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap(); email.typeText(address)
        let password = app.webViews.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 5))
        password.tap(); password.typeText("native-fixture-password")
        let submit = app.webViews.buttons["sign in"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5)); submit.tap()
        let left = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: submit)
        await fulfillment(of: [left], timeout: 20)
        let ready = capture.waitForExistence(timeout: 15)
        if !ready { let tree = XCTAttachment(string: app.debugDescription); tree.name = "M2 home accessibility"; tree.lifetime = .keepAlways; add(tree) }
        XCTAssertTrue(ready)
    }
    func testAuthenticatedSliceAndSessionRestoration() async throws {
        continueAfterFailure = false
        app.terminate(); app.launch()
        if capture.waitForExistence(timeout: 3) {
            open("/profile")
            let signOut = logoutButton
            XCTAssertTrue(signOut.waitForExistence(timeout: 10)); signOut.tap()
        }
        await signIn("native-one@example.test")
        capture.tap()
        let text = app.webViews.textViews["Capture inspiration"]
        XCTAssertTrue(text.waitForExistence(timeout: 10)); text.tap(); text.typeText(captureText)
        let save = app.webViews.buttons["Save inspiration"]
        XCTAssertTrue(save.waitForExistence(timeout: 5)); save.tap()
        let saved = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: save)
        await fulfillment(of: [saved], timeout: 20)
        let (context, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:8787/api/mobile-fixture/context")!)
        let fixture = try JSONSerialization.jsonObject(with: context) as! [String: [String: String]]
        let inspiration = fixture["primary"]!["newestInspirationId"]!
        open("/inspirations/\(inspiration)")
        XCTAssertTrue(app.webViews.staticTexts[captureText].waitForExistence(timeout: 15))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "M2 iOS saved inspiration"; screenshot.lifetime = .keepAlways
        add(screenshot)
        open("/chat/new")
        XCTAssertTrue(app.webViews.textViews.firstMatch.waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(capture.waitForExistence(timeout: 15))
        open("/inspirations/\(inspiration)")
        XCTAssertTrue(app.webViews.staticTexts[captureText].waitForExistence(timeout: 15))
        open("/profile")
        let signOut = logoutButton
        XCTAssertTrue(signOut.waitForExistence(timeout: 15)); signOut.tap()
        XCTAssertTrue(app.webViews.textFields.firstMatch.waitForExistence(timeout: 15))
        await signIn("native-two@example.test")
        open("/inspirations/\(inspiration)")
        XCTAssertFalse(app.webViews.staticTexts[captureText].waitForExistence(timeout: 5))
        let (auditData, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:8787/api/mobile-fixture/audit")!)
        let audit = try JSONSerialization.jsonObject(with: auditData) as! [String: [[String: Any]]]
        XCTAssertTrue(audit["requests"]!.contains { ($0["path"] as? String) == "/api/inspirations/\(inspiration)" && ($0["actor"] as? String) == "secondary" && ($0["status"] as? Int) == 404 })
        open("/profile")
        XCTAssertTrue(signOut.waitForExistence(timeout: 15)); signOut.tap()
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["sign in"].waitForExistence(timeout: 15))
    }
    func testBrowserHandoffCancellationAndRevocation() async throws {
        continueAfterFailure = false
        app.terminate(); app.launch()
        let google = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "continue with google")).firstMatch
        XCTAssertTrue(google.waitForExistence(timeout: 15)); google.tap()
        let synthetic = app.webViews.buttons["Continue synthetic Google"]
        XCTAssertTrue(synthetic.waitForExistence(timeout: 15))
        let done = app.descendants(matching: .button).matching(identifier: "Close").firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        // iOS 26's address element overlaps the close button's centre in AX.
        // Tap the visible left portion of the semantic Close control.
        done.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        XCTAssertTrue(google.waitForExistence(timeout: 10))
        let cancel = app.webViews.buttons["Cancel sign-in"]
        let dismissed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: cancel)
        await fulfillment(of: [dismissed], timeout: 10)
        google.tap(); XCTAssertTrue(synthetic.waitForExistence(timeout: 15)); synthetic.tap()
        let systemOpen = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if systemOpen.waitForExistence(timeout: 3) { systemOpen.tap() }
        let appOpen = app.buttons["Open"]
        if appOpen.waitForExistence(timeout: 2) { appOpen.tap() }
        XCTAssertTrue(capture.waitForExistence(timeout: 20))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "M2 iOS simulated-provider OS handoff"; screenshot.lifetime = .keepAlways; add(screenshot)
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8787/api/mobile-fixture/revoke")!); request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as! HTTPURLResponse).statusCode, 200)
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["sign in"].waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["sign in"].waitForExistence(timeout: 15))
    }
    func testSignupAndExpiredSession() async throws {
        continueAfterFailure = false
        app.terminate(); app.launch()
        if capture.waitForExistence(timeout: 3) {
            open("/profile"); XCTAssertTrue(logoutButton.waitForExistence(timeout: 10)); logoutButton.tap()
        }
        let tab = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", "create account")).firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 15)); tab.tap()
        let address = "native-signup-\(UUID().uuidString.lowercased())@example.test"
        let email = app.webViews.textFields.element(boundBy: 0)
        XCTAssertTrue(email.waitForExistence(timeout: 10)); email.tap(); email.typeText(address)
        let password = app.webViews.secureTextFields.firstMatch
        password.tap(); password.typeText("native-fixture-password")
        let name = app.webViews.textFields.element(boundBy: 1)
        name.tap(); name.typeText("Native signup fixture")
        let submit = app.webViews.buttons.matching(NSPredicate(format: "label ==[c] %@", "create account")).element(boundBy: 1)
        submit.tap()
        // A supplied name completes onboarding in the existing signup API.
        XCTAssertTrue(capture.waitForExistence(timeout: 20))
        app.terminate(); app.launch()
        XCTAssertTrue(capture.waitForExistence(timeout: 15))
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8787/api/mobile-fixture/expire")!); request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as! HTTPURLResponse).statusCode, 200)
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["sign in"].waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["sign in"].waitForExistence(timeout: 15))
    }
}
