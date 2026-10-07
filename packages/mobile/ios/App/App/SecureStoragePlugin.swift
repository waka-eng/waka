import Foundation
import Security
import Capacitor

@objc(SecureStoragePlugin)
public class SecureStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureStoragePlugin"
    public let jsName = "SecureStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]
    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), key.range(of: "^[A-Za-z0-9_.:-]{1,128}$", options: .regularExpression) != nil else {
            call.reject("Invalid secure storage key."); return nil
        }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "\(Bundle.main.bundleIdentifier ?? "im.waka.app").credentials",
                kSecAttrAccount as String: key]
    }
    @objc func get(_ call: CAPPluginCall) {
        guard var request = query(call) else { return }
        request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &found)
        if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let data = found as? Data, let value = String(data: data, encoding: .utf8) else {
            call.reject("Protected storage could not be read.", "KEYCHAIN_\(status)"); return
        }
        call.resolve(["value": value])
    }
    @objc func set(_ call: CAPPluginCall) {
        guard let request = query(call) else { return }
        guard let value = call.getString("value"), let data = value.data(using: .utf8), data.count <= 16384 else {
            call.reject("Invalid secure storage value."); return
        }
        var added = request; added[kSecValueData as String] = data
        added[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        var status = SecItemAdd(added as CFDictionary, nil)
        if status == errSecDuplicateItem { status = SecItemUpdate(request as CFDictionary, [kSecValueData as String: data] as CFDictionary) }
        guard status == errSecSuccess else { call.reject("Protected storage could not be saved.", "KEYCHAIN_\(status)"); return }
        call.resolve()
    }
    @objc func remove(_ call: CAPPluginCall) {
        guard let request = query(call) else { return }
        let status = SecItemDelete(request as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("Protected storage could not be removed.", "KEYCHAIN_\(status)"); return }
        call.resolve()
    }
}
