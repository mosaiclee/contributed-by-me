// Sign an APK with APK Signature Scheme v2 (the scheme of the RhythmDesk 1.59 release) using apksig,
// then verify it. The key and certificate come from one PEM file (PKCS#8 PRIVATE KEY + CERTIFICATE).
// Usage: java -cp apksig-2.3.0.jar SignApk.java KEY.pem IN.apk OUT.apk
import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SignApk {
    static byte[] block(String pem, String label) {
        Matcher m = Pattern.compile("-----BEGIN " + label + "-----([A-Za-z0-9+/=\\s]+)-----END " + label + "-----").matcher(pem);
        if (!m.find()) throw new IllegalArgumentException("PEM has no " + label);
        return Base64.getMimeDecoder().decode(m.group(1));
    }

    public static void main(String[] args) throws Exception {
        String pem = Files.readString(new File(args[0]).toPath());
        PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(block(pem, "PRIVATE KEY")));
        X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(block(pem, "CERTIFICATE")));
        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("RHYTHMDESK", key, List.of(cert)).build();
        new ApkSigner.Builder(List.of(signer))
            .setInputApk(new File(args[1])).setOutputApk(new File(args[2]))
            .setMinSdkVersion(26).setV1SigningEnabled(false).setV2SigningEnabled(true)
            .build().sign();
        ApkVerifier.Result result = new ApkVerifier.Builder(new File(args[2])).build().verify();
        System.out.println("verified=" + result.isVerified() + " v1=" + result.isVerifiedUsingV1Scheme()
            + " v2=" + result.isVerifiedUsingV2Scheme() + " errors=" + result.getErrors() + " warnings=" + result.getWarnings());
        for (X509Certificate c : result.getSignerCertificates()) {
            System.out.println("signer " + c.getSubjectX500Principal() + " sha256="
                + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(c.getEncoded())));
        }
        if (!result.isVerified()) System.exit(1);
    }
}
