import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * Powers the phone's panels `off` or `on` beneath Android, as scrcpy's `--turn-screen-off` does: SurfaceFlinger stops
 * lighting them while Android still has them on, so the game goes on drawing, `screenrecord` goes on recording what it
 * draws and touches go on reaching it. Run as the shell user, by `app_process` with this class's dex on its classpath,
 * since an app may not call these. The mode outlasts the process, until the screen is next turned on or off for real.
 *
 * Reflection throughout, so that it builds against a plain JDK rather than Android's own classes, which the hidden
 * methods it calls are left out of anyway. Android 15's `DisplayManager.requestDisplayPower` is passed over as scrcpy
 * passes it over: it does not leave the display on as Android sees it (Genymobile/scrcpy#5530).
 */
public final class ScreenPower {
    private static final int POWER_MODE_OFF = 0;
    private static final int POWER_MODE_NORMAL = 2;

    public static void main(String[] args) {
        try {
            power(args);
        } catch (Throwable e) {
            // Uncaught, it would end the process with nothing said but `Killed`, the reason going to logcat alone.
            System.err.println(e instanceof InvocationTargetException ? e.getCause() : e);
            System.exit(1);
        }
    }

    private static void power(String[] args) throws Exception {
        if (args.length != 1 || !(args[0].equals("off") || args[0].equals("on"))) {
            throw new IllegalArgumentException("takes off or on");
        }

        int mode = args[0].equals("off") ? POWER_MODE_OFF : POWER_MODE_NORMAL;
        Class<?> surfaceControl = Class.forName("android.view.SurfaceControl");
        Class<?> displays = surfaceControl;

        // Android 14 moved the physical displays out to the system server's `DisplayControl`, which is not on the shell's
        // classpath and needs the system server's native library loaded beside it.
        try {
            surfaceControl.getMethod("getPhysicalDisplayIds");
        } catch (NoSuchMethodException e) {
            Class<?> factory = Class.forName("com.android.internal.os.ClassLoaderFactory");
            Method create = factory.getDeclaredMethod("createClassLoader", String.class, String.class, String.class,
                    ClassLoader.class, int.class, boolean.class, String.class);
            ClassLoader loader = (ClassLoader) create.invoke(null, System.getenv("SYSTEMSERVERCLASSPATH"), null, null,
                    ClassLoader.getSystemClassLoader(), 0, true, null);
            displays = loader.loadClass("com.android.server.display.DisplayControl");

            Method load = Runtime.class.getDeclaredMethod("loadLibrary0", Class.class, String.class);
            load.setAccessible(true);
            load.invoke(Runtime.getRuntime(), displays, "android_servers");
        }

        long[] ids = (long[]) displays.getMethod("getPhysicalDisplayIds").invoke(null);

        if (ids == null || ids.length == 0) {
            throw new IllegalStateException("no physical display");
        }

        Method token = displays.getMethod("getPhysicalDisplayToken", long.class);
        Method power = surfaceControl.getMethod("setDisplayPowerMode", Class.forName("android.os.IBinder"), int.class);

        for (long id : ids) {
            power.invoke(null, token.invoke(null, id), mode);
        }
    }
}
