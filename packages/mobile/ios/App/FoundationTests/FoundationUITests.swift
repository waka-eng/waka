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
        XCTAssertTrue(app.webViews.secureTextFields.firstMatch.waitForExistence(timeout: 15))
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
    private var capture: XCUIElement { app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "new inspiration")).firstMatch }
    private var logoutButton: XCUIElement { app.webViews.buttons.matching(NSPredicate(format: "label ==[c] %@", "sign out")).firstMatch }
    private func openSettings() {
        open("/")
        let settings = app.webViews.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 15)); settings.tap()
        XCTAssertTrue(logoutButton.waitForExistence(timeout: 10))
    }
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
        let submit = app.webViews.buttons["Sign in"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5)); submit.tap()
        let left = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: submit)
        await fulfillment(of: [left], timeout: 20)
        let ready = capture.waitForExistence(timeout: 15)
        if !ready { let tree = XCTAttachment(string: app.debugDescription); tree.name = "M2 home accessibility"; tree.lifetime = .keepAlways; add(tree) }
        XCTAssertTrue(ready)
    }
    private func state() async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:8787/api/mobile-fixture/state")!)
        XCTAssertEqual((response as! HTTPURLResponse).statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    private func persistedState(_ condition: ([String: Any]) -> Bool) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(20)
        var latest = try await state()
        while !condition(latest) && Date() < deadline {
            try await Task.sleep(for: .milliseconds(250))
            latest = try await state()
        }
        XCTAssertTrue(condition(latest), "Expected change was not persisted in the isolated fixture")
        return latest
    }
    func testLoginLogoutAndSessionRestoration() async {
        continueAfterFailure = false
        app.terminate(); app.launch()
        if capture.waitForExistence(timeout: 3) { openSettings(); logoutButton.tap() }
        await signIn("native-one@example.test")
        app.terminate(); app.launch()
        XCTAssertTrue(capture.waitForExistence(timeout: 15))
        openSettings()
        XCTAssertTrue(app.webViews.staticTexts["native-one@example.test"].waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "iOS restored account in settings"; screenshot.lifetime = .keepAlways; add(screenshot)
        logoutButton.tap()
        XCTAssertTrue(app.webViews.secureTextFields.firstMatch.waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.secureTextFields.firstMatch.waitForExistence(timeout: 15))
        await signIn("native-two@example.test")
        openSettings()
        XCTAssertTrue(app.webViews.staticTexts["native-two@example.test"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.webViews.staticTexts["native-one@example.test"].exists)
        logoutButton.tap()
        XCTAssertTrue(app.webViews.secureTextFields.firstMatch.waitForExistence(timeout: 15))
    }
    func testAuthenticatedSliceAndSessionRestoration() async throws {
        continueAfterFailure = false
        app.terminate(); app.launch()
        if capture.waitForExistence(timeout: 3) {
            openSettings()
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
        openSettings()
        let signOut = logoutButton
        XCTAssertTrue(signOut.waitForExistence(timeout: 15)); signOut.tap()
        XCTAssertTrue(app.webViews.textFields.firstMatch.waitForExistence(timeout: 15))
        await signIn("native-two@example.test")
        open("/inspirations/\(inspiration)")
        XCTAssertFalse(app.webViews.staticTexts[captureText].waitForExistence(timeout: 5))
        let (auditData, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:8787/api/mobile-fixture/audit")!)
        let audit = try JSONSerialization.jsonObject(with: auditData) as! [String: [[String: Any]]]
        XCTAssertTrue(audit["requests"]!.contains { ($0["path"] as? String) == "/api/inspirations/\(inspiration)" && ($0["actor"] as? String) == "secondary" && ($0["status"] as? Int) == 404 })
        openSettings()
        XCTAssertTrue(signOut.waitForExistence(timeout: 15)); signOut.tap()
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["Sign in"].waitForExistence(timeout: 15))
    }
    func testBrowserHandoffCancellationAndRevocation() async throws {
        continueAfterFailure = false
        app.terminate(); app.launch()
        if capture.waitForExistence(timeout: 3) { openSettings(); logoutButton.tap() }
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
        XCTAssertTrue(app.webViews.buttons["Sign in"].waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["Sign in"].waitForExistence(timeout: 15))
    }
    func testSignupAndExpiredSession() async throws {
        continueAfterFailure = false
        app.terminate(); app.launch()
        if capture.waitForExistence(timeout: 3) {
            openSettings(); logoutButton.tap()
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
        XCTAssertTrue(app.webViews.buttons["Sign in"].waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["Sign in"].waitForExistence(timeout: 15))
    }
    private func startPrimary() async {
        app.terminate(); app.launch()
        open("/")
        if capture.waitForExistence(timeout: 3) { openSettings(); logoutButton.tap() }
        await signIn("native-one@example.test")
    }
    private func buttonContaining(_ text: String) -> XCUIElement {
        app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }
    private func mediaMenu(_ choice: String) {
        let add = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Add photo or file")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10)); add.tap()
        let option = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", choice)).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 5)); option.tap()
    }
    private func failWrites(_ enabled: Bool) async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8787/api/mobile-fixture/network")!)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["failWrites": enabled])
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as! HTTPURLResponse).statusCode, 200)
    }
    func testUnavailableSaveRetainsDraftAndRetriesOnce() async throws {
        continueAfterFailure = false
        try await failWrites(false)
        await startPrimary(); capture.tap()
        let words = "iPhone connection recovery \(UUID().uuidString.prefix(6))"
        let field = app.webViews.textViews["Capture inspiration"]
        XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText(words)
        try await failWrites(true)
        app.webViews.buttons["Save inspiration"].tap()
        let retry = app.webViews.buttons["Try again"]
        let offered = retry.waitForExistence(timeout: 15)
        try await failWrites(false)
        XCTAssertTrue(offered)
        XCTAssertEqual(field.value as? String, words)
        let before = try await state()
        XCTAssertFalse((before["inspirations"] as! [[String: Any]]).contains { $0["text"] as? String == words })
        snapshot("iPhone unavailable save retains draft")
        retry.tap()
        let persisted = try await persistedState { state in
            (state["inspirations"] as! [[String: Any]]).contains { $0["text"] as? String == words }
        }
        XCTAssertEqual((persisted["inspirations"] as! [[String: Any]]).filter { $0["text"] as? String == words }.count, 1)
        app.terminate(); app.launch(); open("/")
        let after = try await state()
        XCTAssertEqual((after["inspirations"] as! [[String: Any]]).filter { $0["text"] as? String == words }.count, 1)
    }
    private func snapshot(_ name: String) {
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name; tree.lifetime = .keepAlways; add(tree)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    func testPhotosCancelDraftRestoreAndSave() async throws {
        continueAfterFailure = false
        await startPrimary(); capture.tap()
        let words = "iPhone photos " + String(UUID().uuidString.prefix(6))
        let field = app.webViews.textViews["Capture inspiration"]
        XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText(words)
        mediaMenu("Add photo")
        XCTAssertTrue(app.buttons["Photo Library"].waitForExistence(timeout: 5)); app.buttons["Photo Library"].tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 10)); app.buttons["Cancel"].tap()
        XCTAssertEqual(field.value as? String, words)
        XCTAssertEqual(app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Remove ")).count, 0)
        mediaMenu("Add photo"); app.buttons["Photo Library"].tap()
        let photos = app.images.matching(identifier: "PXGGridLayout-Info")
        XCTAssertTrue(photos.firstMatch.waitForExistence(timeout: 10))
        // The dedicated simulator has the synthetic blue fixture plus Apple's sample photos.
        photos.element(boundBy: 0).tap(); photos.element(boundBy: 1).tap()
        app.buttons["Done"].tap()
        let removals = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Remove "))
        let ready = expectation(for: NSPredicate(format: "count == 2"), evaluatedWith: removals)
        await fulfillment(of: [ready], timeout: 15)
        snapshot("iPhone selected photo previews")
        XCUIDevice.shared.press(.home); app.activate()
        let resumed = expectation(for: NSPredicate(format: "count == 2"), evaluatedWith: removals)
        await fulfillment(of: [resumed], timeout: 10)
        XCTAssertEqual(field.value as? String, words)
        app.terminate(); app.launch()
        if !field.waitForExistence(timeout: 3) { XCTAssertTrue(capture.waitForExistence(timeout: 10)); capture.tap() }
        XCTAssertEqual(field.value as? String, words)
        let restored = expectation(for: NSPredicate(format: "count == 2"), evaluatedWith: removals)
        await fulfillment(of: [restored], timeout: 10)
        snapshot("iPhone restored photo draft")
        app.webViews.buttons["Save inspiration"].tap()
        let persisted = try await persistedState { state in
            guard let note = (state["inspirations"] as! [[String: Any]]).first(where: { $0["text"] as? String == words }) else { return false }
            return (state["attachments"] as! [[String: Any]]).filter { $0["inspiration_id"] as? String == note["id"] as? String }.count == 2
        }
        let note = (persisted["inspirations"] as! [[String: Any]]).first { $0["text"] as? String == words }!
        let media = (persisted["attachments"] as! [[String: Any]]).filter { $0["inspiration_id"] as? String == note["id"] as? String }
        XCTAssertTrue(media.allSatisfy { $0["type"] as? String == "image" && (Int(String(describing: $0["size"]!)) ?? 0) > 0 })
        app.webViews.buttons["All inspirations"].tap()
        let row = buttonContaining(words); XCTAssertTrue(row.waitForExistence(timeout: 10)); row.tap()
        let images = app.webViews.images
        let loaded = expectation(for: NSPredicate(format: "count == 2"), evaluatedWith: images)
        await fulfillment(of: [loaded], timeout: 10)
        snapshot("iPhone saved photo note")
    }
    func testFilePickerCancelAndSave() async throws {
        continueAfterFailure = false
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.open(URL(string: "http://127.0.0.1:8787/api/mobile-fixture/sample.txt")!)
        let download = safari.buttons["Download"]
        XCTAssertTrue(download.waitForExistence(timeout: 10)); download.tap()
        await startPrimary(); capture.tap()
        let words = "iPhone file fixture " + String(UUID().uuidString.prefix(6))
        let field = app.webViews.textViews["Capture inspiration"]
        XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText(words)
        mediaMenu("Add file")
        if app.buttons["Choose Files"].waitForExistence(timeout: 2) { app.buttons["Choose Files"].tap() }
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 10)); app.buttons["Cancel"].tap()
        XCTAssertEqual(field.value as? String, words)
        mediaMenu("Add file")
        if app.buttons["Choose Files"].waitForExistence(timeout: 2) { app.buttons["Choose Files"].tap() }
        app.buttons["Browse"].tap()
        let local = app.cells["DOC.sidebar.item.On My iPhone"]
        if !local.waitForExistence(timeout: 2) { app.buttons["DOC.navBarButton.backInHistory"].tap() }
        XCTAssertTrue(local.waitForExistence(timeout: 10)); local.tap()
        let downloads = app.cells["Downloads, Folder"]
        XCTAssertTrue(downloads.waitForExistence(timeout: 10)); downloads.tap()
        let file = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "waka-media-fixture")).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 10)); file.tap()
        let choose = app.buttons["Open"]
        if choose.waitForExistence(timeout: 2) { choose.tap() }
        let remove = buttonContaining("Remove waka-media-fixture")
        XCTAssertTrue(remove.waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        if !field.waitForExistence(timeout: 3) { XCTAssertTrue(capture.waitForExistence(timeout: 10)); capture.tap() }
        XCTAssertEqual(field.value as? String, words); XCTAssertTrue(remove.waitForExistence(timeout: 10))
        snapshot("iPhone restored file draft")
        app.webViews.buttons["Save inspiration"].tap()
        let persisted = try await persistedState { state in
            guard let note = (state["inspirations"] as! [[String: Any]]).first(where: { $0["text"] as? String == words }) else { return false }
            return (state["attachments"] as! [[String: Any]]).filter { $0["inspiration_id"] as? String == note["id"] as? String && $0["type"] as? String == "file" }.count == 1
        }
        let note = (persisted["inspirations"] as! [[String: Any]]).first { $0["text"] as? String == words }!
        let attachment = (persisted["attachments"] as! [[String: Any]]).first { $0["inspiration_id"] as? String == note["id"] as? String }!
        XCTAssertEqual(attachment["content_type"] as? String, "text/plain")
        app.webViews.buttons["All inspirations"].tap()
        let row = buttonContaining(words); XCTAssertTrue(row.waitForExistence(timeout: 10)); row.tap()
        XCTAssertTrue(app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "waka-media-fixture")).firstMatch.waitForExistence(timeout: 10))
        snapshot("iPhone saved file note")
    }
    func testRecordingStopsOnBackgroundAndKeepsClip() async throws {
        continueAfterFailure = false
        await startPrimary()
        let words = "iPhone interrupted recording \(UUID().uuidString.prefix(6))"
        let id = try await captureNote(words)
        app.webViews.buttons["All inspirations"].tap()
        let row = buttonContaining(words); XCTAssertTrue(row.waitForExistence(timeout: 10)); row.tap()
        let record = app.webViews.buttons["Record"]
        XCTAssertTrue(record.waitForExistence(timeout: 10)); record.tap()
        let stop = app.webViews.buttons["Stop recording"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        try await Task.sleep(for: .seconds(3))
        XCUIDevice.shared.press(.home)
        try await Task.sleep(for: .seconds(2))
        app.activate()
        XCTAssertTrue(record.waitForExistence(timeout: 10)); XCTAssertFalse(stop.exists)
        let persisted = try await persistedState { state in
            (state["attachments"] as! [[String: Any]]).filter { $0["inspiration_id"] as? String == id }.count == 1
        }
        let clip = (persisted["attachments"] as! [[String: Any]]).first { $0["inspiration_id"] as? String == id }!
        XCTAssertEqual(clip["type"] as? String, "audio")
        XCTAssertTrue((clip["content_type"] as? String ?? "").hasPrefix("audio/"))
        XCTAssertGreaterThan(Int(String(describing: clip["size"]!)) ?? 0, 0)
        snapshot("iPhone recording kept after background")
        app.terminate(); app.launch(); open("/")
        XCTAssertTrue(app.webViews.buttons["All inspirations"].waitForExistence(timeout: 10)); app.webViews.buttons["All inspirations"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 10)); row.tap()
        let play = app.webViews.buttons["Play"]
        XCTAssertTrue(play.waitForExistence(timeout: 10)); play.tap()
        XCTAssertTrue(app.webViews.buttons["Pause"].waitForExistence(timeout: 2)); app.webViews.buttons["Pause"].tap()
        snapshot("iPhone saved recording after restart")
    }
    private func replaceText(_ field: XCUIElement, with words: String) {
        XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.press(forDuration: 1)
        let selectAll = app.buttons["Select All"]
        if selectAll.waitForExistence(timeout: 2) { selectAll.tap() }
        else { let menu = app.menuItems["Select All"]; XCTAssertTrue(menu.waitForExistence(timeout: 2)); menu.tap() }
        field.typeText(words)
    }
    private func captureNote(_ words: String, owner: String? = nil) async throws -> String {
        XCTAssertTrue(capture.waitForExistence(timeout: 15)); capture.tap()
        let field = app.webViews.textViews["Capture inspiration"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        if let owner { XCTAssertTrue(app.webViews.staticTexts["Saving to \(owner)"].waitForExistence(timeout: 10)) }
        field.tap(); field.typeText(words)
        let save = app.webViews.buttons["Save inspiration"]
        XCTAssertTrue(save.waitForExistence(timeout: 5)); save.tap()
        let saved = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: save)
        await fulfillment(of: [saved], timeout: 20)
        let persisted = try await persistedState { state in (state["inspirations"] as? [[String: Any]])?.contains { $0["text"] as? String == words } == true }
        return (persisted["inspirations"] as! [[String: Any]]).first { $0["text"] as? String == words }!["id"] as! String
    }
    func testInspirationEditSearchDeleteAndRestore() async throws {
        continueAfterFailure = false
        await startPrimary()
        let original = "Mobile lifecycle \(UUID().uuidString.prefix(8)): make room for thought."
        let id = try await captureNote(original)
        app.webViews.buttons["All inspirations"].tap()
        let row = buttonContaining(original)
        XCTAssertTrue(row.waitForExistence(timeout: 15)); row.tap()
        let field = app.webViews.textViews["Capture inspiration"]
        XCTAssertTrue(field.waitForExistence(timeout: 15)); XCTAssertEqual(field.value as? String, original)
        let edited = original + " Keep one small experiment."
        replaceText(field, with: edited)
        app.webViews.buttons["Save inspiration"].tap()
        _ = try await persistedState { state in (state["inspirations"] as? [[String: Any]])?.contains { $0["id"] as? String == id && $0["text"] as? String == edited } == true }
        app.webViews.buttons["Back"].tap()
        let search = app.webViews.searchFields["Search what you kept"]
        XCTAssertTrue(search.waitForExistence(timeout: 10)); search.tap(); search.typeText(String(original.prefix(25)))
        let editedRow = buttonContaining(edited)
        XCTAssertTrue(editedRow.waitForExistence(timeout: 15)); editedRow.tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10)); XCTAssertEqual(field.value as? String, edited)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "iOS edited inspiration"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.webViews.buttons["Delete"].tap()
        _ = try await persistedState { state in !(state["inspirations"] as! [[String: Any]]).contains { $0["id"] as? String == id } }
        open("/inspirations")
        let deleted = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", "Deleted")).firstMatch
        XCTAssertTrue(deleted.waitForExistence(timeout: 10)); deleted.tap()
        let restore = app.webViews.buttons["Bring back"]
        XCTAssertTrue(restore.waitForExistence(timeout: 10)); restore.tap()
        _ = try await persistedState { state in (state["inspirations"] as! [[String: Any]]).contains { $0["id"] as? String == id && $0["text"] as? String == edited } }
        app.terminate(); app.launch(); open("/inspirations")
        XCTAssertTrue(buttonContaining(edited).waitForExistence(timeout: 15))
    }
    func testChatHistoryDraftSendAndDelete() async throws {
        continueAfterFailure = false
        await startPrimary()
        app.webViews.buttons["All chats"].tap()
        let seeded = buttonContaining("How can I leave room to think?")
        XCTAssertTrue(seeded.waitForExistence(timeout: 15)); seeded.tap()
        XCTAssertTrue(app.webViews.staticTexts["Start with one small experiment. This is a synthetic fixture reply."].waitForExistence(timeout: 15))
        open("/chat/new")
        let editor = app.webViews.textViews["Your message"]
        XCTAssertTrue(editor.waitForExistence(timeout: 15))
        let words = "Mobile chat \(UUID().uuidString.prefix(8)): keep my draft across restart."
        editor.tap(); editor.typeText(words)
        app.terminate(); app.launch(); open("/chat/new")
        XCTAssertTrue(editor.waitForExistence(timeout: 15)); XCTAssertEqual(editor.value as? String, words)
        app.webViews.buttons["Send"].tap()
        let persisted = try await persistedState { state in (state["messages"] as! [[String: Any]]).contains { $0["content"] as? String == words } }
        let id = (persisted["messages"] as! [[String: Any]]).first { $0["content"] as? String == words }!["conversation_id"] as! String
        XCTAssertTrue(app.webViews.staticTexts[words].waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.buttons["All chats"].waitForExistence(timeout: 15)); app.webViews.buttons["All chats"].tap()
        let search = app.webViews.searchFields["Search chats"]
        XCTAssertTrue(search.waitForExistence(timeout: 15)); search.tap(); search.typeText(String(words.prefix(22)))
        XCTAssertTrue(buttonContaining(words).waitForExistence(timeout: 15))
        app.webViews.buttons["Delete"].tap()
        app.webViews.buttons["Not now"].tap()
        XCTAssertTrue(buttonContaining(words).exists)
        app.webViews.buttons["Delete"].tap(); app.webViews.buttons["Delete it anyway"].tap()
        _ = try await persistedState { state in (state["conversations"] as! [[String: Any]]).contains { $0["id"] as? String == id && $0["deleted_at"] is String } }
        XCTAssertFalse(buttonContaining(words).exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "iOS filtered chat removed"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    func testAgentProfilesMemoryAndKeyIsolation() async throws {
        continueAfterFailure = false
        await startPrimary()
        let suffix = String(UUID().uuidString.prefix(5))
        let names = ["Noah \(suffix)", "Another \(suffix)"]
        var ids: [String] = []
        openSettings(); app.webViews.buttons["Agent profiles"].tap()
        for name in names {
            let field = app.webViews.textFields.matching(NSPredicate(format: "label == %@ AND value == %@", "Agent profile name", "Agent profile name")).firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText(name)
            app.webViews.buttons["Create agent profile"].tap()
            let persisted = try await persistedState { state in (state["profiles"] as! [[String: Any]]).contains { $0["name"] as? String == name } }
            ids.append((persisted["profiles"] as! [[String: Any]]).first { $0["name"] as? String == name }!["id"] as! String)
        }
        app.webViews.buttons["Close"].tap()
        for (index, name) in names.enumerated() {
            open("/")
            let choice = app.webViews.switches.matching(NSPredicate(format: "label ==[c] %@", name)).firstMatch
            XCTAssertTrue(choice.waitForExistence(timeout: 15)); choice.tap()
            let words = "Only \(name) owns this mobile memory."
            let note = try await captureNote(words, owner: name)
            XCTAssertFalse(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "I keep room to think before committing.")).firstMatch.exists)
            let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "iOS distinct agent \(index + 1)"; shot.lifetime = .keepAlways; add(shot)
            let persisted = try await state()
            XCTAssertTrue((persisted["inspirations"] as! [[String: Any]]).contains { $0["id"] as? String == note && $0["profile_id"] as? String == ids[index] })
            app.webViews.buttons["All inspirations"].tap()
            XCTAssertTrue(buttonContaining(words).waitForExistence(timeout: 15))
            XCTAssertFalse(buttonContaining("Only \(names[1-index]) owns this mobile memory.").exists)
            XCTAssertFalse(buttonContaining("A synthetic native fixture: simple tools leave room to think.").exists)
            app.webViews.buttons["Close"].tap()
            app.webViews.buttons["New chat"].tap()
            let chat = app.webViews.textViews["Your message"]
            XCTAssertTrue(chat.waitForExistence(timeout: 15)); chat.tap(); chat.typeText("Only \(name) owns this chat.")
            app.webViews.buttons["Send"].tap()
            _ = try await persistedState { state in (state["messages"] as! [[String: Any]]).contains { $0["content"] as? String == "Only \(name) owns this chat." && $0["profile_id"] as? String == ids[index] } }
            app.webViews.buttons["Close"].tap()
            app.webViews.buttons["All chats"].tap()
            XCTAssertTrue(buttonContaining("Only \(name) owns this chat.").waitForExistence(timeout: 15))
            XCTAssertFalse(buttonContaining("Only \(names[1-index]) owns this chat.").exists)
            XCTAssertFalse(buttonContaining("How can I leave room to think?").exists)
        }
        openSettings(); app.webViews.buttons["Agent profiles"].tap()
        let access = app.webViews.buttons["Connections and API keys for \(names[0])"]
        XCTAssertTrue(access.waitForExistence(timeout: 15)); access.tap()
        app.webViews.switches.matching(NSPredicate(format: "label ==[c] %@", "API keys")).firstMatch.tap()
        let label = app.webViews.textFields["Key name, e.g. Work laptop"]
        XCTAssertTrue(label.waitForExistence(timeout: 10)); label.tap(); label.typeText("iPhone isolation fixture")
        app.webViews.buttons["Create key"].tap()
        let secretField = app.webViews.textFields["API key"]
        XCTAssertTrue(secretField.waitForExistence(timeout: 10))
        let secret = try XCTUnwrap(secretField.value as? String)
        // Never attach a screenshot or log the one-time credential.
        app.webViews.buttons["I’ve saved the key"].tap()
        let fixtureState = try await state()
        let human = (fixtureState["profiles"] as! [[String: Any]]).first { $0["type"] as? String == "human" }!["id"] as! String
        for (target, allowed) in [(ids[0], true), (ids[1], false), (human, false)] {
            var request = URLRequest(url: URL(string: "http://127.0.0.1:8787/api/inspirations?profile=\(target)")!)
            request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
            let (_, response) = try await URLSession.shared.data(for: request)
            let status = (response as! HTTPURLResponse).statusCode
            if allowed { XCTAssertEqual(status, 200) } else { XCTAssertTrue([403, 404].contains(status)) }
            request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["text": "Bound key write for \(names[0])."])
            let (_, writeResponse) = try await URLSession.shared.data(for: request)
            let writeStatus = (writeResponse as! HTTPURLResponse).statusCode
            if allowed { XCTAssertEqual(writeStatus, 201) } else { XCTAssertTrue([403, 404].contains(writeStatus)) }
        }
        let afterKeyWrite = try await state()
        let keyWrites = (afterKeyWrite["inspirations"] as! [[String: Any]])
            .filter { $0["text"] as? String == "Bound key write for \(names[0])." }
        XCTAssertEqual(keyWrites.count, 1)
        XCTAssertEqual(keyWrites.first?["profile_id"] as? String, ids[0])
        app.webViews.buttons["Revoke key"].tap(); app.webViews.buttons["Revoke this key"].tap()
        XCTAssertTrue(app.webViews.staticTexts["No active API keys for this agent."].waitForExistence(timeout: 10))
        var denied = URLRequest(url: URL(string: "http://127.0.0.1:8787/api/inspirations")!)
        denied.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        let (_, revoked) = try await URLSession.shared.data(for: denied)
        XCTAssertEqual((revoked as! HTTPURLResponse).statusCode, 401)
        app.webViews.buttons["Back to agent profiles"].tap()
        let renamed = names[1] + " renamed"
        let profileName = app.webViews.textFields.matching(NSPredicate(format: "value == %@", names[1])).firstMatch
        replaceText(profileName, with: renamed)
        app.webViews.textFields.matching(NSPredicate(format: "value == %@", renamed)).firstMatch.typeText("\n")
        _ = try await persistedState { state in (state["profiles"] as! [[String: Any]]).contains { $0["id"] as? String == ids[1] && $0["name"] as? String == renamed } }
        let renamedField = app.webViews.textFields.matching(NSPredicate(format: "value == %@", renamed)).firstMatch
        let deletes = app.webViews.buttons.matching(identifier: "Delete profile")
        // iOS orders the empty create field separately from profile rows.
        // Match the delete control on this named row, not the input's index.
        let index = try XCTUnwrap((0..<deletes.count).first {
            abs(deletes.element(boundBy: $0).frame.midY - renamedField.frame.midY) < 2
        })
        let remove = deletes.element(boundBy: index)
        remove.tap(); app.webViews.buttons["Cancel"].tap()
        XCTAssertTrue(profileName.exists || app.webViews.textFields.matching(NSPredicate(format: "value == %@", renamed)).firstMatch.exists)
        let cancelled = try await state()
        XCTAssertTrue((cancelled["profiles"] as! [[String: Any]]).contains { $0["id"] as? String == ids[1] })
        remove.tap(); app.webViews.buttons["Delete profile and memory"].tap()
        let remaining = try await persistedState { state in
            !(state["profiles"] as! [[String: Any]]).contains { $0["id"] as? String == ids[1] }
                && !(state["inspirations"] as! [[String: Any]]).contains { $0["profile_id"] as? String == ids[1] }
                && !(state["conversations"] as! [[String: Any]]).contains { $0["profile_id"] as? String == ids[1] }
        }
        for owner in [ids[0], human] {
            XCTAssertTrue((remaining["profiles"] as! [[String: Any]]).contains { $0["id"] as? String == owner })
            XCTAssertTrue((remaining["inspirations"] as! [[String: Any]]).contains { $0["profile_id"] as? String == owner })
            XCTAssertTrue((remaining["conversations"] as! [[String: Any]]).contains { $0["profile_id"] as? String == owner })
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "iOS remaining agent after confirmed deletion"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    func testReadingAndPrincipleEdit() async {
        continueAfterFailure = false
        await startPrimary()
        let reading = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "I keep room to think before committing.")).firstMatch
        XCTAssertTrue(reading.waitForExistence(timeout: 15))
        let home = XCTAttachment(screenshot: app.screenshot()); home.name = "iOS seeded top of mind"; home.lifetime = .keepAlways; add(home)
        open("/principles")
        let principle = buttonContaining("Leave space for a small experiment.")
        XCTAssertTrue(principle.waitForExistence(timeout: 15)); principle.tap()
        let edit = app.webViews.buttons["Edit wording"]
        XCTAssertTrue(edit.waitForExistence(timeout: 15)); edit.tap()
        let words = "Protect a little space for a small experiment."
        let field = app.webViews.textViews["This principle in your own words"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        // Select the fixture's single paragraph; iOS's word-selection menu
        // does not always offer Select All for a textarea.
        field.tap(withNumberOfTaps: 3, numberOfTouches: 1); field.typeText(words)
        XCTAssertEqual(field.value as? String, words)
        app.webViews.buttons["Save"].tap()
        let saved = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: field)
        await fulfillment(of: [saved], timeout: 15)
        app.terminate(); app.launch(); open("/principles")
        XCTAssertTrue(buttonContaining(words).waitForExistence(timeout: 15))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "iOS persisted principle wording"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    func testProfileEditPersistsAcrossRestart() async throws {
        continueAfterFailure = false
        app.terminate(); app.launch()
        if !capture.waitForExistence(timeout: 3) { await signIn("native-one@example.test") }
        openSettings()
        let name = app.webViews.textFields.firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap(); name.press(forDuration: 1.0)
        let selectAll = app.buttons["Select All"]
        if selectAll.waitForExistence(timeout: 2) { selectAll.tap() }
        else { let menu = app.menuItems["Select All"]; XCTAssertTrue(menu.waitForExistence(timeout: 2)); menu.tap() }
        let updated = "Native profile " + String(UUID().uuidString.prefix(6))
        name.typeText(updated)
        let keyboard = XCTAttachment(screenshot: app.screenshot()); keyboard.name = "iOS Settings above dock with keyboard"; keyboard.lifetime = .keepAlways; add(keyboard)
        _ = try await persistedState { state in
            (state["profiles"] as? [[String: Any]])?.contains { $0["type"] as? String == "human" && $0["name"] as? String == updated } == true
        }
        app.terminate(); app.launch(); XCTAssertTrue(capture.waitForExistence(timeout: 15))
        openSettings()
        XCTAssertTrue(name.waitForExistence(timeout: 10)); XCTAssertEqual(name.value as? String, updated)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "M2 iOS persisted profile edit"; screenshot.lifetime = .keepAlways; add(screenshot)
        XCTAssertTrue(logoutButton.waitForExistence(timeout: 10)); logoutButton.tap()
    }
}
