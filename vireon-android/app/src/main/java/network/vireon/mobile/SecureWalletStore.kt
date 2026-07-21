package network.vireon.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class WalletProfile(val id: String, val name: String, val address: String, val publicKeyHex: String, val derivationPath: String)
data class WalletMaterial(val profile: WalletProfile, val mnemonic: String)

class SecureWalletStore(context: Context) {
    private val preferences = context.getSharedPreferences("vireon_wallets_v1", Context.MODE_PRIVATE)
    private val keyAlias = "vireon-mobile-wallet-encryption-v1"

    fun wallets(): List<WalletProfile> {
        val array = JSONArray(preferences.getString("profiles", "[]"))
        return (0 until array.length()).map { index -> profileFromJson(array.getJSONObject(index)) }
    }

    fun activeWallet(): WalletProfile? {
        val active = preferences.getString("active", null)
        return wallets().firstOrNull { it.id == active } ?: wallets().firstOrNull()
    }

    fun select(id: String) {
        require(wallets().any { it.id == id }) { "Wallet does not exist" }
        preferences.edit().putString("active", id).apply()
    }

    fun store(name: String, nativeResponse: String): WalletMaterial {
        val response = JSONObject(nativeResponse)
        require(response.optBoolean("ok")) { response.optString("error", "Wallet operation failed") }
        val wallet = response.getJSONObject("wallet")
        val address = wallet.getString("address")
        val profile = WalletProfile(address, name.trim(), address, wallet.getString("public_key_hex"), wallet.getString("derivation_path"))
        val updated = wallets().filterNot { it.id == profile.id } + profile
        val profiles = JSONArray().also { array -> updated.forEach { array.put(profileToJson(it)) } }
        preferences.edit()
            .putString("profiles", profiles.toString())
            .putString("active", profile.id)
            .putString("secret_${profile.id}", encrypt(wallet.getString("mnemonic")))
            .apply()
        return WalletMaterial(profile, wallet.getString("mnemonic"))
    }

    fun mnemonic(id: String): String {
        val encrypted = requireNotNull(preferences.getString("secret_$id", null)) { "Encrypted wallet material is missing" }
        return decrypt(encrypted)
    }

    private fun encryptionKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(false)
                .build())
            generateKey()
        }
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        val payload = JSONObject()
            .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
        return payload.toString()
    }

    private fun decrypt(value: String): String {
        val payload = JSONObject(value)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, Base64.decode(payload.getString("iv"), Base64.NO_WRAP)))
        return cipher.doFinal(Base64.decode(payload.getString("ciphertext"), Base64.NO_WRAP)).toString(Charsets.UTF_8)
    }

    private fun profileToJson(profile: WalletProfile) = JSONObject()
        .put("id", profile.id).put("name", profile.name).put("address", profile.address)
        .put("public_key_hex", profile.publicKeyHex).put("derivation_path", profile.derivationPath)

    private fun profileFromJson(json: JSONObject) = WalletProfile(
        json.getString("id"), json.getString("name"), json.getString("address"),
        json.getString("public_key_hex"), json.getString("derivation_path")
    )
}
