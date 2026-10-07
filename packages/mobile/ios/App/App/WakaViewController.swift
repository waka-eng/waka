import Capacitor
class WakaViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(SecureStoragePlugin()) }
}
