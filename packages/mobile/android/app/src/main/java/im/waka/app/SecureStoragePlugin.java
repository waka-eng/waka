package im.waka.app;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Ciphertext is app-private; the AES key never leaves Android Keystore.
 * A decrypt failure refuses access instead of falling back to plaintext. */
@CapacitorPlugin(name = "SecureStorage")
public class SecureStoragePlugin extends Plugin {
    private static final String ALIAS = "waka.credentials";
    private SharedPreferences preferences() { return getContext().getSharedPreferences("waka-protected-credentials", Context.MODE_PRIVATE); }
    private String key(PluginCall call) {
        String key = call.getString("key");
        if (key == null || !key.matches("[A-Za-z0-9_.:-]{1,128}")) { call.reject("Invalid secure storage key."); return null; }
        return key;
    }
    private SecretKey protectedKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        SecretKey key = (SecretKey) store.getKey(ALIAS, null);
        if (key != null) return key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    @PluginMethod public void get(PluginCall call) {
        String key = key(call); if (key == null) return;
        String saved = preferences().getString(key, null);
        if (saved == null) { call.resolve(new JSObject().put("value", JSONObject.NULL)); return; }
        try {
            JSONObject record = new JSONObject(saved);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, protectedKey(), new GCMParameterSpec(128, Base64.decode(record.getString("iv"), Base64.NO_WRAP)));
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            byte[] plain = cipher.doFinal(Base64.decode(record.getString("ciphertext"), Base64.NO_WRAP));
            call.resolve(new JSObject().put("value", new String(plain, StandardCharsets.UTF_8)));
        } catch (Exception error) { call.reject("Protected storage could not be read.", "KEYSTORE_READ_FAILED"); }
    }
    @PluginMethod public void set(PluginCall call) {
        String key = key(call); if (key == null) return;
        String value = call.getString("value");
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 16384) { call.reject("Invalid secure storage value."); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, protectedKey());
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            JSONObject record = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP));
            if (!preferences().edit().putString(key, record.toString()).commit()) throw new Exception("Commit failed");
            call.resolve();
        } catch (Exception error) { call.reject("Protected storage could not be saved.", "KEYSTORE_WRITE_FAILED"); }
    }
    @PluginMethod public void remove(PluginCall call) {
        String key = key(call); if (key == null) return;
        if (!preferences().edit().remove(key).commit()) { call.reject("Protected storage could not be removed."); return; }
        call.resolve();
    }
}
