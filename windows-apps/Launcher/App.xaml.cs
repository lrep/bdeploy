﻿using Bdeploy.Shared;
using Serilog;
using System.IO;
using System.Threading.Tasks;
using System.Windows;

namespace Bdeploy.Launcher
{
    /// <summary>
    /// Interaction logic for App.xaml
    /// </summary>
    public partial class App : Application
    {
        /// Exit code of the launcher signaling that an update is available
        public static readonly int EX_UPDATE = 42;

        // Window shown while we are waiting 
        private WaitingWindow waitingWindow;

        /// <summary>
        /// Callback method that is called on application startup
        /// </summary>
        async void App_Startup(object sender, StartupEventArgs e)
        {
            // Set the shutdown mode. Otherwise we won't be able to 
            // Show the same window multiple times in our callback
            this.ShutdownMode = ShutdownMode.OnExplicitShutdown;

            // Initialize logging infrastructure
            string path = Path.Combine(PathProvider.GetLogsDir(), "launcher-log.txt");
            Log.Logger = LogFactory.CreateGlobalLogger(path);

            // The application to launch must be passed
            if (e.Args.Length != 1)
            {
                Log.Fatal("The descriptor of the application to launch is missing.");
                Log.Fatal("Usage: BDeploy.exe myApp.bdeploy");
                Log.Information("Exiting application.");
                Current.Shutdown(-1);
                return;
            }
            string application = e.Args[0];

            // Launch and wait for termination
            AppLauncher launcher = new AppLauncher(application);
            launcher.UpdateFailed += Launcher_UpdateFailed;
            launcher.UpdateWaiting += Launcher_UpdateWaiting;
            launcher.StartUpdating += Launcher_StartUpdating;

            int exitCode = launcher.Start();
            if (exitCode != EX_UPDATE)
            {
                Current.Shutdown(0);
                return;
            }

            // Apply updates
            bool success = await Task.Run(() => launcher.ApplyUpdates());
            if (!success)
            {
                Current.Shutdown(-1);
                return;
            }

            // Startup launcher with original arguments
            if (!launcher.Restart())
            {
                Current.Shutdown(-1);
                return;
            }
            Current.Shutdown(0);
        }

        /// <summary>
        /// Event raised by the launcher when the update is starting
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void Launcher_StartUpdating(object sender, object e)
        {
            Dispatcher.Invoke(() =>
            {
                if (waitingWindow != null)
                {
                    waitingWindow.Close();
                    waitingWindow = null;
                }
            });
        }

        /// <summary>
        /// Event raised by the launcher in case that another operation is in progress.
        /// </summary>
        private void Launcher_UpdateWaiting(object sender, CancelEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                waitingWindow = new WaitingWindow(e);
                waitingWindow.Show();
            });
        }

        /// <summary>
        /// Event raised by the launcher in case that the update cannot be applied.
        /// </summary>
        private void Launcher_UpdateFailed(object sender, RetryCancelEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                ErrorWindow window = new ErrorWindow(e);
                window.ShowDialog();
            });
        }
    }
}