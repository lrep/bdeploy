﻿using Bdeploy.Installer.Models;
using Bdeploy.Shared;
using System;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading.Tasks;

namespace Bdeploy.Installer {
    /// <summary>
    /// Downloads and unpacks the launcher.
    /// </summary>
    public class AppInstaller {
        /// <summary>
        /// Directory where BDeploy stores all files 
        /// </summary>
        private readonly string bdeployHome = PathProvider.GetBdeployHome();

        /// <summary>
        /// Directory where the launcher is stored. (HOME_DIR\launcher) 
        /// </summary>
        private readonly string launcherHome = PathProvider.GetLauncherDir();

        /// <summary>
        /// Directory where the application are stored. (HOME_DIR\apps) 
        /// </summary>
        private readonly string appsHome = PathProvider.GetApplicationsDir();

        /// <summary>
        /// Lock file that is created to avoid that multiple installers run simultaneously
        /// </summary>
        private readonly string lockFile = Path.Combine(PathProvider.GetBdeployHome(), ".lock");

        /// <summary>
        /// Flag indicating whether or not to cancel the operattion
        /// </summary>
        public bool Canceled { get; internal set; }

        /// <summary>
        /// Event that is raised when some work has been done
        /// </summary>
        public event EventHandler<WorkedEventArgs> Worked;

        /// <summary>
        /// Event that is raised when a new task has been started
        /// </summary>
        public event EventHandler<SubTaskEventArgs> NewSubtask;

        /// <summary>
        /// Event that is raised when an error occurred
        /// </summary>
        public event EventHandler<MessageEventArgs> Error;

        /// <summary>
        /// Event that is raised when the launcher has been installed.
        /// </summary>
        public event EventHandler<EventArgs> LauncherInstalled;

        /// <summary>
        /// Event that is raised when the icon has been loaded
        /// </summary>
        public event EventHandler<IconEventArgs> IconLoaded;

        /// <summary>
        /// Event that is raised to update text about the application to install.
        /// </summary>
        public event EventHandler<AppInfoEventArgs> AppInfo;

        /// <summary>
        /// Embedded configuration object
        /// </summary>
        public readonly Config config;

        /// <summary>
        /// Creates a new installer instance.
        /// </summary>
        public AppInstaller(Config config) {
            this.config = config;
        }

        /// <summary>
        /// Launches the previously installed application. Does not wait for termination
        /// </summary>
        /// <returns></returns>
        public void Launch() {
            string appUid = config.ApplicationUid;
            string appShortcut = Path.Combine(appsHome, appUid, "launch.bdeploy");
            Utils.RunProcess(PathProvider.GetLauncherExecutable(), appShortcut);
        }

        /// <summary>
        /// Executes the installer and performs all tasks.
        /// </summary>
        public async Task<int> Setup() {
            FileStream lockStream = null;
            try {
                // Show error message if configuration is invalid
                if (config == null || !config.CanInstallLauncher()) {
                    StringBuilder builder = new StringBuilder();
                    builder.Append("Configuration is invalid or corrupt.").AppendLine().AppendLine();
                    builder.Append("Configuration:").AppendLine();
                    builder.Append(config == null ? "<null>" : config.ToString()).AppendLine();
                    builder.Append("Embedded:").AppendLine();
                    builder.Append(ConfigStorage.ReadEmbeddedConfigFile()).AppendLine();
                    OnError(builder.ToString());
                    return -1;
                }

                // Show error message if we do not have write permissions in our home directory
                if (FileHelper.IsReadOnly(PathProvider.GetBdeployHome())) {
                    StringBuilder builder = new StringBuilder();
                    builder.Append("Installation directory is read-only. Please check permissions.").AppendLine().AppendLine();
                    builder.AppendFormat("BDEPLOY_HOME={0}", PathProvider.GetBdeployHome()).AppendLine();
                    OnError(builder.ToString());
                    return -1;
                }
                UpdateAppInfo();

                // Prepare directories
                Directory.CreateDirectory(bdeployHome);
                Directory.CreateDirectory(launcherHome);
                Directory.CreateDirectory(appsHome);

                // Prepare home directory of the application if required
                if (config.CanInstallApp()) {
                    Directory.CreateDirectory(Path.Combine(appsHome, config.ApplicationUid));
                }

                // Installers should not run simultaneously to avoid conflicts when extracting files
                // Thus we try to create a lockfile. If it exists we wait until it is removed
                OnNewSubtask("Waiting for other installations to finish...", -1);
                lockStream = FileHelper.WaitForExclusiveLock(lockFile, 500, () => Canceled);
                if (lockStream == null) {
                    OnError("Installation has been canceled by the user.");
                    return -1;
                }

                // Download and store icon and splash
                OnNewSubtask("Preparing...", -1);
                await DownloadIcon();
                await DownloadSplash();

                // Download and extract if not available
                if (!IsLauncherInstalled()) {
                    bool success = await DownloadAndExtractLauncher();
                    if (!success) {
                        return -1;
                    }
                }

                // Associate bdeploy files with the launcher
                CreateFileAssociation();

                // Store embedded application information
                // Not present in case that just the launcher should be installed
                if (config.CanInstallApp()) {
                    InstallApplication();
                } else {
                    LauncherInstalled?.Invoke(this, new EventArgs());
                }
                return 0;
            } catch (Exception ex) {
                OnError(ex.ToString());
                return -1;
            } finally {
                // Release lock
                if (lockStream != null) {
                    lockStream.Dispose();
                }
                FileHelper.DeleteFile(lockFile);
            }
        }

        /// <summary>
        /// Associates .bdeploy files with the launcher
        /// </summary>
        private void CreateFileAssociation() {
            string launcher = PathProvider.GetLauncherExecutable();
            string fileAssoc = PathProvider.GetFileAssocExecutable();
            string arguments = string.Format("{0} \"{1}\"", "/CreateForCurrentUser", launcher);
            Utils.RunProcess(fileAssoc, arguments);
        }

        /// <summary>
        /// Installs the application and creates the shortcut and registry entries
        /// </summary>
        private void InstallApplication() {
            string instanceGroup = config.InstanceGroupName;
            string instance = config.InstanceName;
            string appName = config.ApplicationName;
            string appUid = config.ApplicationUid;
            string productVendor = config.ProductVendor ?? "BDeploy";

            string appDescriptor = Path.Combine(appsHome, appUid, "launch.bdeploy");
            string icon = Path.Combine(appsHome, appUid, "icon.ico");

            // Always write file as it might be outdated
            bool createShortcut = !File.Exists(appDescriptor);
            File.WriteAllText(appDescriptor, config.ClickAndStartDescriptor);

            // Read existing registry entry
            SoftwareEntryData data = SoftwareEntry.Read(config.ApplicationUid);
            if (data == null) {
                data = new SoftwareEntryData();
            }

            // Only create shortcut if we just have written the descriptor
            if (createShortcut) {
                data.DesktopShortcut = Shortcut.CreateDesktopLink(instanceGroup, instance, appName, appDescriptor, launcherHome, icon);
                data.StartMenuShortcut = Shortcut.CreateStartMenuLink(instanceGroup, instance, appName, productVendor, appDescriptor, launcherHome, icon);
            }

            // Create or update registry entry
            data.noModifyAndRepair = true;
            data.Publisher = productVendor;
            data.DisplayIcon = icon;
            data.DisplayName = string.Format("{0} ({1} - {2})", appName, instanceGroup, instance);
            data.InstallDate = DateTime.Now.ToString("yyyyMMdd");
            data.InstallLocation = string.Format("\"{0}\"", Path.Combine(appsHome, appUid));
            data.UninstallString = string.Format("\"{0}\" /Uninstall \"{1}\"", PathProvider.GetLauncherExecutable(), appDescriptor);
            data.QuietUninstallString = string.Format("\"{0}\" /Unattended /Uninstall \"{1}\"", PathProvider.GetLauncherExecutable(), appDescriptor);
            SoftwareEntry.Create(appUid, data);
        }

        /// <summary>
        /// Downloads and extracts the launcher.
        /// </summary>
        private async Task<bool> DownloadAndExtractLauncher() {
            // Launcher directory must not exist. 
            // Otherwise ZIP extraction fails
            FileHelper.DeleteDir(launcherHome);

            // Prepare tmp directory
            string tmpDir = PathProvider.GetTmpDir();
            Directory.CreateDirectory(tmpDir);

            // Download and extract
            string launcherZip = await DownloadLauncher(tmpDir);
            if (launcherZip == null) {
                return false;
            }

            ExtractLauncher(launcherZip, launcherHome);

            // Cleanup. Download not required any more
            FileHelper.DeleteDir(tmpDir);
            return true;
        }

        /// <summary>
        /// Downloads the icon and stores it in the local file system.
        /// </summary>
        public async Task DownloadIcon() {
            // Icon is optional
            if (config.IconUrl == null) {
                return;
            }

            Uri requestUrl = new Uri(config.IconUrl);
            using (HttpClient client = CreateHttpClient())
            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, requestUrl))
            using (HttpResponseMessage response = await client.GetAsync(requestUrl)) {
                if (!response.IsSuccessStatusCode) {
                    Console.WriteLine("Cannot download application icon. Error {0} - {1} ", response.ReasonPhrase, request.RequestUri);
                    return;
                }

                // Get the extension of the file from the headers. 
                string iconName = GetFileName(response);
                string iconFormat = Path.GetExtension(iconName);

                string appUid = config.ApplicationUid;
                string iconFile = Path.Combine(appsHome, appUid, "icon" + iconFormat);
                using (Stream responseStream = await response.Content.ReadAsStreamAsync())
                using (FileStream fileStream = new FileStream(iconFile, FileMode.Create)) {
                    await responseStream.CopyToAsync(fileStream);
                }

                // Notify UI that we have an icon
                IconLoaded?.Invoke(this, new IconEventArgs(iconFile));
            }
        }

        /// <summary>
        /// Downloads the splash screen and stores it in the local file system.
        /// </summary>
        public async Task DownloadSplash() {
            // Splash screen is optional
            if (config.SplashUrl == null) {
                return;
            }
            Uri requestUrl = new Uri(config.SplashUrl);
            using (HttpClient client = CreateHttpClient())
            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, requestUrl))
            using (HttpResponseMessage response = await client.GetAsync(requestUrl)) {
                if (!response.IsSuccessStatusCode) {
                    Console.WriteLine("Cannot download application splash. Error {0} - {1} ", response.ReasonPhrase, request.RequestUri);
                    return;
                }

                // Get the extension of the file from the headers. 
                string splashName = GetFileName(response);
                string splashFormat = Path.GetExtension(splashName);

                string appUid = config.ApplicationUid;
                string splashFile = Path.Combine(appsHome, appUid, "splash" + splashFormat);
                using (Stream responseStream = await response.Content.ReadAsStreamAsync())
                using (FileStream fileStream = new FileStream(splashFile, FileMode.Create)) {
                    await responseStream.CopyToAsync(fileStream);
                }
            }
        }

        /// <summary>
        /// Notifies the UI about the application that is installed
        /// </summary>
        private void UpdateAppInfo() {
            // Skip if we do not install an application
            if (!config.CanInstallApp()) {
                AppInfo?.Invoke(this, new AppInfoEventArgs("BDeploy Click & Start Launcher", "BDeploy Team"));
                return;
            }
            AppInfo?.Invoke(this, new AppInfoEventArgs(config.ApplicationName, config.ProductVendor));
        }

        /// <summary>
        /// Returns the file name set in the content disposition header
        /// </summary>
        /// <returns></returns>
        private string GetFileName(HttpResponseMessage response) {
            // name might be quoted: "splash.bmp". Remove them
            string fileName = response.Content.Headers.ContentDisposition.FileName;
            if (fileName.StartsWith("\"")) {
                fileName = fileName.Substring(1, fileName.Length - 2);
            }
            return fileName;
        }

        /// <summary>
        /// Creates a new HTTP client that validates the certificate provided by the server against the embedded.
        /// </summary>
        /// <returns></returns>
        private HttpClient CreateHttpClient() {
            WebRequestHandler handler = new WebRequestHandler();
            handler.ServerCertificateValidationCallback += (sender, cert, chain, error) => {
                X509Certificate2 root = SecurityHelper.LoadCertificate(config.RemoteService);
                return SecurityHelper.Verify(root, (X509Certificate2)cert);
            };
            return new HttpClient(handler, true);
        }

        /// <summary>
        /// Downloads the launcher and stores it in the given directory
        /// </summary>
        private async Task<string> DownloadLauncher(string tmpDir) {
            Uri requestUrl = new Uri(config.LauncherUrl);
            string tmpFileName = Path.Combine(tmpDir, Guid.NewGuid() + ".download");
            using (HttpClient client = CreateHttpClient())
            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, requestUrl))
            using (HttpResponseMessage response = await client.GetAsync(requestUrl, HttpCompletionOption.ResponseHeadersRead)) {
                if (!response.IsSuccessStatusCode) {
                    StringBuilder builder = new StringBuilder();
                    builder.Append("Failed to download application launcher.").AppendLine().AppendLine();
                    builder.AppendFormat("Request: {0}", request.RequestUri).AppendLine();
                    builder.AppendFormat("Status: {0}", response.StatusCode).AppendLine();
                    builder.AppendFormat("Response: {0}", response.ReasonPhrase);
                    OnError(builder.ToString());
                    return null;
                }

                long? contentLength = response.Content.Headers.ContentLength;
                if (contentLength.HasValue) {
                    OnNewSubtask("Downloading...", contentLength.Value);
                } else {
                    OnNewSubtask("Downloading...", -1);
                }

                using (Stream contentStream = await response.Content.ReadAsStreamAsync())
                using (FileStream fileStream = new FileStream(tmpFileName, FileMode.Create, FileAccess.Write, FileShare.None, 8192, true)) {
                    await CopyStreamAsync(contentStream, fileStream);
                }
            }

            // Rename to ZIP when finished
            var zipFileName = Path.Combine(tmpDir, Guid.NewGuid() + ".zip");
            File.Move(tmpFileName, zipFileName);
            return zipFileName;
        }

        /// <summary>
        /// Reads from the given stream and writes the content to the other stream.
        /// </summary>
        /// <returns></returns>
        private async Task CopyStreamAsync(Stream contentStream, FileStream fileStream) {
            var buffer = new byte[8192];
            while (true) {
                var read = await contentStream.ReadAsync(buffer, 0, buffer.Length);
                if (read == 0) {
                    return;
                }
                await fileStream.WriteAsync(buffer, 0, read);
                OnWorked(read);
            }
        }

        /// <summary>
        /// Extracts the ZIP file.
        /// </summary>
        /// <returns></returns>
        private void ExtractLauncher(string launcherZip, string targetDir) {
            using (ZipArchive archive = ZipFile.OpenRead(launcherZip)) {
                OnNewSubtask("Unpacking...", archive.Entries.Count);
                // Enforce directory separator at the end. 
                if (!targetDir.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)) {
                    targetDir += Path.DirectorySeparatorChar;
                }
                foreach (ZipArchiveEntry entry in archive.Entries) {
                    // ZIP contains a single directory with all files in it
                    // Thus we remove the starting directory to unpack all files directly into the target directory
                    string entryName = entry.FullName.Replace('\\', '/');
                    string extractName = entryName.Substring(entryName.IndexOf('/') + 1);
                    string destination = Path.GetFullPath(Path.Combine(targetDir, extractName));

                    // Ensure we do not extract to a directory outside of our control
                    if (!destination.StartsWith(targetDir, StringComparison.Ordinal)) {
                        Console.WriteLine("ZIP-Entry contains invalid path. Expecting: {0} but was {1}", targetDir, destination);
                        continue;
                    }

                    // Directory entries do not have the name attribute
                    bool isDirectory = entry.Name.Length == 0;
                    if (isDirectory) {
                        Directory.CreateDirectory(destination);
                    } else {
                        entry.ExtractToFile(destination);
                    }

                    // Notify about extraction progress
                    OnWorked(1);
                }
            }
        }

        /// <summary>
        /// Returns whether or not the launcher is already installed.
        /// </summary>
        private bool IsLauncherInstalled() {
            return File.Exists(PathProvider.GetLauncherExecutable());
        }

        /// <summary>
        /// Notify that a new task has been started
        /// </summary>
        private void OnNewSubtask(string taskName, long totalWork) {
            NewSubtask?.Invoke(this, new SubTaskEventArgs(taskName, totalWork));
        }

        /// <summary>
        /// Notify that some work has been done
        /// </summary>
        private void OnWorked(long worked) {
            Worked?.Invoke(this, new WorkedEventArgs(worked));
        }

        /// <summary>
        /// Notify that an error occurred
        /// </summary>
        private void OnError(string message) {
            Error?.Invoke(this, new MessageEventArgs(message));
        }
    }
}
