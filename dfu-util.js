var device = null;
(function() {
    'use strict';

    function hex4(n) {
        let s = n.toString(16)
        while (s.length < 4) {
            s = '0' + s;
        }
        return s;
    }

    function hexAddr8(n) {
        let s = n.toString(16)
        while (s.length < 8) {
            s = '0' + s;
        }
        return "0x" + s;
    }

    function niceSize(n) {
        const gigabyte = 1024 * 1024 * 1024;
        const megabyte = 1024 * 1024;
        const kilobyte = 1024;
        if (n >= gigabyte) {
            return n / gigabyte + "GiB";
        } else if (n >= megabyte) {
            return n / megabyte + "MiB";
        } else if (n >= kilobyte) {
            return n / kilobyte + "KiB";
        } else {
            return n + "B";
        }
    }

    function formatDFUSummary(device) {
        const vid = hex4(device.device_.vendorId);
        const pid = hex4(device.device_.productId);
        const name = device.device_.productName;

        let mode = "Unknown"
        if (device.settings.alternate.interfaceProtocol == 0x01) {
            mode = "Runtime";
        } else if (device.settings.alternate.interfaceProtocol == 0x02) {
            mode = "DFU";
        }

        const cfg = device.settings.configuration.configurationValue;
        const intf = device.settings["interface"].interfaceNumber;
        const alt = device.settings.alternate.alternateSetting;
        const serial = device.device_.serialNumber;
        let info = `${mode}: [${vid}:${pid}] cfg=${cfg}, intf=${intf}, alt=${alt}, name="${name}" serial="${serial}"`;
        return info;
    }

    function formatDFUInterfaceAlternate(settings) {
        let mode = "Unknown"
        if (settings.alternate.interfaceProtocol == 0x01) {
            mode = "Runtime";
        } else if (settings.alternate.interfaceProtocol == 0x02) {
            mode = "DFU";
        }

        const cfg = settings.configuration.configurationValue;
        const intf = settings["interface"].interfaceNumber;
        const alt = settings.alternate.alternateSetting;
        const name = (settings.name) ? settings.name : "UNKNOWN";

        return `${mode}: cfg=${cfg}, intf=${intf}, alt=${alt}, name="${name}"`;
    }

    async function fixInterfaceNames(device_, interfaces) {
        // Check if any interface names were not read correctly
        if (interfaces.some(intf => (intf.name == null))) {
            // Manually retrieve the interface name string descriptors
            let tempDevice = new dfu.Device(device_, interfaces[0]);
            await tempDevice.device_.open();
            let mapping = await tempDevice.readInterfaceNames();
            await tempDevice.close();

            for (let intf of interfaces) {
                if (intf.name === null) {
                    let configIndex = intf.configuration.configurationValue;
                    let intfNumber = intf["interface"].interfaceNumber;
                    let alt = intf.alternate.alternateSetting;
                    intf.name = mapping[configIndex][intfNumber][alt];
                }
            }
        }
    }

    //ここの表示は丸々いらない？
    // function populateInterfaceList(form, device_, interfaces) {
    //     let old_choices = Array.from(form.getElementsByTagName("div"));
    //     for (let radio_div of old_choices) {
    //         form.removeChild(radio_div);
    //     }

    //     let button = form.getElementsByTagName("button")[0];

    //     for (let i=0; i < interfaces.length; i++) {
    //         let radio = document.createElement("input");
    //         radio.type = "radio";
    //         radio.name = "interfaceIndex";
    //         radio.value = i;
    //         radio.id = "interface" + i;
    //         radio.required = true;

    //         let label = document.createElement("label");
    //         label.textContent = formatDFUInterfaceAlternate(interfaces[i]);
    //         label.className = "radio"
    //         label.setAttribute("for", "interface" + i);

    //         let div = document.createElement("div");
    //         div.appendChild(radio);
    //         div.appendChild(label);
    //         form.insertBefore(div, button);
    //     }
    // }

    function getDFUDescriptorProperties(device) {
        // Attempt to read the DFU functional descriptor
        // TODO: read the selected configuration's descriptor
        return device.readConfigurationDescriptor(0).then(
            data => {
                let configDesc = dfu.parseConfigurationDescriptor(data);
                let funcDesc = null;
                let configValue = device.settings.configuration.configurationValue;
                if (configDesc.bConfigurationValue == configValue) {
                    for (let desc of configDesc.descriptors) {
                        if (desc.bDescriptorType == 0x21 && desc.hasOwnProperty("bcdDFUVersion")) {
                            funcDesc = desc;
                            break;
                        }
                    }
                }

                if (funcDesc) {
                    return {
                        WillDetach:            ((funcDesc.bmAttributes & 0x08) != 0),
                        ManifestationTolerant: ((funcDesc.bmAttributes & 0x04) != 0),
                        CanUpload:             ((funcDesc.bmAttributes & 0x02) != 0),
                        CanDnload:             ((funcDesc.bmAttributes & 0x01) != 0),
                        TransferSize:          funcDesc.wTransferSize,
                        DetachTimeOut:         funcDesc.wDetachTimeOut,
                        DFUVersion:            funcDesc.bcdDFUVersion
                    };
                } else {
                    return {};
                }
            },
            error => {}
        );
    }

    // Current log div element to append to
    let logContext = null;

    function setLogContext(div) {
        logContext = div;
    };

    function clearLog(context) {
        if (typeof context === 'undefined') {
            context = logContext;
        }
        if (context) {
            context.innerHTML = "";
        }
    }

    function logDebug(msg) {
        console.log(msg);
    }

    function logInfo(msg) {
        if (logContext) {
            let info = document.createElement("div");
            info.className = "info";
            info.textContent = msg;
            logContext.appendChild(info);
        }
    }

    function logWarning(msg) {
        if (logContext) {
            let warning = document.createElement("p");
            warning.className = "warning";
            warning.textContent = msg;
            logContext.appendChild(warning);
        }
    }

    function logError(msg) {
        if (logContext) {
            let error = document.createElement("p");
            error.className = "error";
            error.textContent = msg;
            logContext.appendChild(error);
        }
    }

    //プログレスバー
    function logProgress(done, total) {
        if (logContext) {
            let progressBar;
            if (logContext.lastChild.tagName.toLowerCase() == "progress") {
                progressBar = logContext.lastChild;
            }
            if (!progressBar) {
                progressBar = document.createElement("progress");
                logContext.appendChild(progressBar);
            }
            console.log(done, '**************done');
            progressBar.value = done;
            if (typeof total !== 'undefined') {
                progressBar.max = total;
            }
            console.log(progressBar, '***************progressBar');
        }
    }

    document.addEventListener('DOMContentLoaded', event => {
        let modalParipi = document.querySelector("#modal-paripi");
        let page1 = document.querySelector("#page-1");
        let page2 = document.querySelector("#page-2");
        let page3 = document.querySelector("#page-3");
        let page4 = document.querySelector("#page-4");
        let page5 = document.querySelector("#page-5");
        let setParipi = document.querySelector("#set-paripi");
        let connectButton = document.querySelector("#connect");
        //let detachButton = document.querySelector("#detach");
        //追加分
        let updateButton = document.querySelector("#update");
        //let downloadButton = document.querySelector("#download");
        let uploadButton = document.querySelector("#upload");
        //接続デバイスのステータス表示
        //let statusDisplay = document.querySelector("#status");
        //let infoDisplay = document.querySelector("#usbInfo");
        //let dfuDisplay = document.querySelector("#dfuInfo");
        //let vidField = document.querySelector("#vid");
        //let interfaceDialog = document.querySelector("#interfaceDialog");
        //let interfaceForm = document.querySelector("#interfaceForm");
        //let interfaceSelectButton = document.querySelector("#selectInterface");

        let searchParams = new URLSearchParams(window.location.search);
        let fromLandingPage = false;
        let vid = 0;
        // Set the vendor ID from the landing page URL
        // if (searchParams.has("vid")) {
        //     const vidString = searchParams.get("vid");
        //     try {
        //         if (vidString.toLowerCase().startsWith("0x")) {
        //             vid = parseInt(vidString, 16);
        //         } else {
        //             vid = parseInt(vidString, 10);
        //         }
        //         vidField.value = "0x" + hex4(vid).toUpperCase();
        //         fromLandingPage = true;
        //     } catch (error) {
        //         console.log("Bad VID " + vidString + ":" + error);
        //     }
        // }

        // Grab the serial number from the landing page
        let serial = "";
        if (searchParams.has("serial")) {
            serial = searchParams.get("serial");
            // Workaround for Chromium issue 339054
            if (window.location.search.endsWith("/") && serial.endsWith("/")) {
                serial = serial.substring(0, serial.length-1);
            }
            fromLandingPage = true;
        }

        //let configForm = document.querySelector("#configForm");

        //let transferSizeField = document.querySelector("#transferSize");
        //let transferSize = parseInt(transferSizeField.value);
        let transferSize = 1024;

        //let dfuseStartAddressField = document.querySelector("#dfuseStartAddress");
        //let dfuseUploadSizeField = document.querySelector("#dfuseUploadSize");

        //let firmwareFileField = document.querySelector("#firmwareFile");
        let firmwareFile = null;

        let downloadLog = document.querySelector("#downloadLog");
        let uploadLog = document.querySelector("#uploadLog");

        let manifestationTolerant = true;

        //let device;
        
        function fadeIn(node, duration) {
            // display: noneでないときは何もしない
            if (getComputedStyle(node).display !== 'none') return;
            
            // style属性にdisplay: noneが設定されていたとき
            if (node.style.display === 'none') {
              node.style.display = '';
            } else {
              node.style.display = 'block';
            }
            node.style.opacity = 0;
          
            var start = performance.now();
            
            requestAnimationFrame(function tick(timestamp) {
              // イージング計算式（linear）
              var easing = (timestamp - start) / duration;
          
              // opacityが1を超えないように
              node.style.opacity = Math.min(easing, 1);
          
              // opacityが1より小さいとき
              if (easing < 1) {
                requestAnimationFrame(tick);
              } else {
                node.style.opacity = '';
              }
            });
        }
        fadeIn(modalParipi, 500);

        function onDisconnect(reason) {
            if (reason) {
                //statusDisplay.textContent = reason;
                console.log(reason);
            }

            connectButton.textContent = "Connect";
            //infoDisplay.textContent = "";
            //dfuDisplay.textContent = "";
            //detachButton.disabled = true;
            updateButton.disabled = true;
            uploadButton.disabled = true;
            //downloadButton.disabled = true;
            //firmwareFileField.disabled = true;
        }

        function onUnexpectedDisconnect(event) {
            if (device !== null && device.device_ !== null) {
                if (device.device_ === event.device) {
                    device.disconnected = true;
                    onDisconnect("Device disconnected");
                    device = null;
                }
            }
        }

        //接続ファンクション
        async function connect(device) {
            try {
                await device.open();
            } catch (error) {
                onDisconnect(error);
                throw error;
            }

            // Attempt to parse the DFU functional descriptor
            let desc = {};
            try {
                desc = await getDFUDescriptorProperties(device);
            } catch (error) {
                onDisconnect(error);
                throw error;
            }

            let memorySummary = "";
            if (desc && Object.keys(desc).length > 0) {
                device.properties = desc;
                //let info = `WillDetach=${desc.WillDetach}, ManifestationTolerant=${desc.ManifestationTolerant}, CanUpload=${desc.CanUpload}, CanDnload=${desc.CanDnload}, TransferSize=${desc.TransferSize}, DetachTimeOut=${desc.DetachTimeOut}, Version=${hex4(desc.DFUVersion)}`;
                page2.style.display = "none";
                fadeIn(page3, 500);
                //dfuDisplay.textContent += "\n" + info;
                //transferSizeField.value = desc.TransferSize;
                transferSize = desc.TransferSize;
                if (desc.CanDnload) {
                    manifestationTolerant = desc.ManifestationTolerant;
                }

                if (device.settings.alternate.interfaceProtocol == 0x02) {
                    if (!desc.CanUpload) {
                        uploadButton.disabled = true;
                        //dfuseUploadSizeField.disabled = true;
                    }
                    if (!desc.CanDnload) {
                        //dnloadButton.disabled = true;
                        updateButton.disabled = true;
                    }
                }

                if (desc.DFUVersion == 0x011a && device.settings.alternate.interfaceProtocol == 0x02) {
                    device = new dfuse.Device(device.device_, device.settings);
                    if (device.memoryInfo) {
                        let totalSize = 0;
                        for (let segment of device.memoryInfo.segments) {
                            totalSize += segment.end - segment.start;
                        }
                        memorySummary = `Selected memory region: ${device.memoryInfo.name} (${niceSize(totalSize)})`;
                        for (let segment of device.memoryInfo.segments) {
                            let properties = [];
                            if (segment.readable) {
                                properties.push("readable");
                            }
                            if (segment.erasable) {
                                properties.push("erasable");
                            }
                            if (segment.writable) {
                                properties.push("writable");
                            }
                            let propertySummary = properties.join(", ");
                            if (!propertySummary) {
                                propertySummary = "inaccessible";
                            }

                            memorySummary += `\n${hexAddr8(segment.start)}-${hexAddr8(segment.end-1)} (${propertySummary})`;
                        }
                    }
                }
            }
            
            // Bind logging methods
            device.logDebug = logDebug;
            device.logInfo = logInfo;
            device.logWarning = logWarning;
            device.logError = logError;
            device.logProgress = logProgress;

            // Clear logs
            clearLog(uploadLog);
            clearLog(downloadLog);

            // Display basic USB information
            //statusDisplay.textContent = '';
            connectButton.textContent = 'Disconnect';
            // infoDisplay.textContent = (
            //     "Name: " + device.device_.productName + "\n" +
            //     "MFG: " + device.device_.manufacturerName + "\n" +
            //     "Serial: " + device.device_.serialNumber + "\n"
            // );

            // Display basic dfu-util style info
            //dfuDisplay.textContent = formatDFUSummary(device) + "\n" + memorySummary;

            // Update buttons based on capabilities
            if (device.settings.alternate.interfaceProtocol == 0x01) {
                // Runtime
                //detachButton.disabled = false;
                updateButton.disabled = true;
                uploadButton.disabled = true;
                //downloadButton.disabled = true;
                //firmwareFileField.disabled = true;
            } else {
                // DFU
                //detachButton.disabled = true;
                updateButton.disabled = false;
                uploadButton.disabled = false;
                //downloadButton.disabled = false;
                //firmwareFileField.disabled = false;
            }

            if (device.memoryInfo) {
                //let dfuseFieldsDiv = document.querySelector("#dfuseFields")
                //dfuseFieldsDiv.hidden = false;
                //dfuseStartAddressField.disabled = false;
                //dfuseUploadSizeField.disabled = false;
                let segment = device.getFirstWritableSegment();
                if (segment) {
                    device.startAddress = segment.start;
                    //dfuseStartAddressField.value = "0x" + segment.start.toString(16);
                    const maxReadSize = device.getMaxReadSize(segment.start);
                    //dfuseUploadSizeField.value = maxReadSize;
                    //dfuseUploadSizeField.max = maxReadSize;
                }
            } //else {
                //let dfuseFieldsDiv = document.querySelector("#dfuseFields")
                //dfuseFieldsDiv.hidden = true;
                //dfuseStartAddressField.disabled = true;
                //dfuseUploadSizeField.disabled = true;
            //}

            return device;
        }

        function autoConnect(vid, serial) {
            //ここでデバイス情報を取得
            dfu.findAllDfuInterfaces().then(
                //返却されたデバイス
                async dfu_devices => {
                    let matching_devices = [];
                    for (let dfu_device of dfu_devices) {
                        if (serial) {
                            if (dfu_device.device_.serialNumber == serial) {
                                matching_devices.push(dfu_device);
                            }
                        } else if (dfu_device.device_.vendorId == vid) {
                            matching_devices.push(dfu_device);
                        }
                    }

                    if (matching_devices.length == 0) {
                        //statusDisplay.textContent = 'No device found.';
                        console.log('No device found.');
                    } else {
                        if (matching_devices.length == 1) {
                            //statusDisplay.textContent = 'Connecting...';
                            console.log('Connecting...');
                            device = matching_devices[0];
                            //console.log(device);
                            device = await connect(device);
                        } else {
                            //statusDisplay.textContent = "Multiple DFU interfaces found.";
                            console.log('Multiple DFU interfaces found.');
                        }
                        //vidField.value = "0x" + hex4(matching_devices[0].device_.vendorId).toUpperCase();
                        vid = matching_devices[0].device_.vendorId;
                    }
                }
            );
        }

        // vidField.addEventListener("change", function() {
        //     vid = parseInt(vidField.value, 16);
        // });

        // transferSizeField.addEventListener("change", function() {
        //     transferSize = parseInt(transferSizeField.value);
        // });

        // dfuseStartAddressField.addEventListener("change", function(event) {
        //     const field = event.target;
        //     let address = parseInt(field.value, 16);
        //     if (isNaN(address)) {
        //         field.setCustomValidity("Invalid hexadecimal start address");
        //     } else if (device && device.memoryInfo) {
        //         if (device.getSegment(address) !== null) {
        //             device.startAddress = address;
        //             field.setCustomValidity("");
        //             dfuseUploadSizeField.max = device.getMaxReadSize(address);
        //         } else {
        //             field.setCustomValidity("Address outside of memory map");
        //         }
        //     } else {
        //         field.setCustomValidity("");
        //     }
        // });

        setParipi.addEventListener('click', function() {
            page1.style.display = 'none';
            fadeIn(page2, 500);
        })

        //connectボタンを押した時の処理
        connectButton.addEventListener('click', function() {
            if (device) {
                device.close().then(onDisconnect);
                device = null;
            } else {
                let filters = [];
                if (serial) {
                    filters.push({ 'serialNumber': serial });
                } else if (vid) {
                    filters.push({ 'vendorId': vid });
                }
                //async selectedDevie requestDeviceは戻り値
                navigator.usb.requestDevice({ 'filters': filters }).then(
                    //ここでawaitを使用している
                    async selectedDevice => {
                        let interfaces = dfu.findDeviceDfuInterfaces(selectedDevice);
                        if (interfaces.length == 0) {
                            //console.log(selectedDevice);
                            //statusDisplay.textContent = "The selected device does not have any USB DFU interfaces.";
                            console.log("The selected device does not have any USB DFU interfaces.");
                        } else if (interfaces.length == 1) {
                            await fixInterfaceNames(selectedDevice, interfaces);
                            //ここでawaitを使用している
                            //最終的にdeviceが決定？
                            device = await connect(new dfu.Device(selectedDevice, interfaces[0]));
                        } else {
                            //ここでawaitを使用している
                            await fixInterfaceNames(selectedDevice, interfaces);
                            //populateInterfaceList(interfaceForm, selectedDevice, interfaces);
                            //ここでsubmitするインターフェイスが決定する？
                            //submitするとこいつが呼ばれるてdeviceが決定する
                            //自動的にこれ発動したいからconnectToSelectedInterfaceをふつうに呼び出す
                            async function connectToSelectedInterface() {
                                //interfaceForm.removeEventListener('submit', this);
                                //これふつうに0番目読めばええんやね
                                //コメントアウト
                                //const index = interfaceForm.elements["interfaceIndex"].value;
                                //const index = interfaceForm.elements[0].value;
                                //ここでawaitを使用している
                                //最終的にdeviceが決定？
                                //device = await connect(new dfu.Device(selectedDevice, interfaces[index]));
                                device = await connect(new dfu.Device(selectedDevice, interfaces[0]));
                            }
                            connectToSelectedInterface()
                            //ここでsubmitを待つ変わりにconnectToSelectedInterfaceを叩くように
                            //変更する？？？？
                            //コメントアウト
                            //interfaceForm.addEventListener('submit', connectToSelectedInterface);

                            //コメントアウト
                            //interfaceDialog.addEventListener('cancel', function () {
                            //    interfaceDialog.removeEventListener('cancel', this);
                            //    interfaceForm.removeEventListener('submit', connectToSelectedInterface);
                            //});
                            //submitのイベントはinterfaceFormが受ける
                            //ここはあとでコメントアウトだ
                            //interfaceDialog.showModal();
                        }
                    }
                ).catch(error => {
                    //statusDisplay.textContent = error;
                    console.log(error);
                });
            }
        });

        //あとで実装
        // detachButton.addEventListener('click', function() {
        //     if (device) {
        //         device.detach().then(
        //             async len => {
        //                 let detached = false;
        //                 try {
        //                     await device.close();
        //                     await device.waitDisconnected(5000);
        //                     detached = true;
        //                 } catch (err) {
        //                     console.log("Detach failed: " + err);
        //                 }

        //                 onDisconnect();
        //                 device = null;
        //                 if (detached) {
        //                     // Wait a few seconds and try reconnecting
        //                     setTimeout(autoConnect, 5000);
        //                 }
        //             },
        //             async error => {
        //                 await device.close();
        //                 onDisconnect(error);
        //                 device = null;
        //             }
        //         );
        //     }
        // });

        //不要？
        uploadButton.addEventListener('click', async function(event) {
            event.preventDefault();
            event.stopPropagation();
            //input要素の入力内容の検証を実行
            // if (!configForm.checkValidity()) {
            //     //ダメならこっちに入る
            //     configForm.reportValidity();
            //     return false;
            // }
            //deviceチェック
            if (!device || !device.device_.opened) {
                onDisconnect();
                device = null;
            } else {
                setLogContext(uploadLog);
                clearLog(uploadLog);
                try {
                    let status = await device.getStatus();
                    if (status.state == dfu.dfuERROR) {
                        await device.clearStatus();
                    }
                } catch (error) {
                    device.logWarning("Failed to clear status");
                }

                let maxSize = Infinity;
                //if (!dfuseUploadSizeField.disabled) {
                //    maxSize = parseInt(dfuseUploadSizeField.value);
                //}
                //最大アップロードサイズ
                maxSize = 262144;

                try {
                    const blob = await device.do_upload(transferSize, maxSize);
                    saveAs(blob, "firmware.bin");
                } catch (error) {
                    logError(error);
                }

                setLogContext(null);
            }

            return false;
        });

        //ファイル読み込み用なので不要？
        //firmwareFileField.addEventListener("change", function() {
            //コメントアウト
            //firmwareFile = null;
            //if (firmwareFileField.files.length > 0) {
            //    let file = firmwareFileField.files[0];
            //    let reader = new FileReader();
            //    reader.onload = function() {
            //        firmwareFile = reader.result;
            //        console.log('*****firmwareFile');
            //        console.log(firmwareFile);
            //    };
            //    console.log('file: ', file);
            //    reader.readAsArrayBuffer(file);
            //}
        //});

        //今回追加分の処理
        updateButton.addEventListener('click', function() {
            event.preventDefault();
            event.stopPropagation();
            firmwareFile = null;
            page3.style.display = 'none';
            fadeIn(page4, 500);
            //リダイレクトは伝搬が原因？？？
            //あとでパラメータにタイムスタンプ与えること
            let targetFile = document.querySelector("li, .active")
            let url = targetFile.getAttribute('data-url');
            console.log(url, '*********');
            fetch(url).then(function(response) {
                return response.blob();
                }).then(function(blob) {
                    // blobにBlob型で結果が渡される
                    let reader = new FileReader();
                    reader.onload = function() {
                        firmwareFile = reader.result;
                        startDownload();
                    }
                     //reader.readAsDataURL(blob);
                    reader.readAsArrayBuffer(blob);
                });
            });


        //イベント監視開始
        //downloadButton.addEventListener('click', async function(event) {
        async function startDownload() {
            //イベント伝搬を止める？
            //event.preventDefault();
            //イベント伝搬を止める？
            //event.stopPropagation();
            //input要素の入力内容の検証を実行
            // if (!configForm.checkValidity()) {
            //     //ダメならこっちに入る
            //     configForm.reportValidity();
            //     return false;
            // }
            //deviceチェック＆バイナリnullチェック
            //console.log('firmwareFile: ', firmwareFile);
            if (device && firmwareFile != null) {
                setLogContext(downloadLog);
                clearLog(downloadLog);
                try {
                    let status = await device.getStatus();
                    if (status.state == dfu.dfuERROR) {
                        await device.clearStatus();
                    }
                } catch (error) {
                    device.logWarning("Failed to clear status");
                }
                //ここで書き込みかなあ
                await device.do_download(transferSize, firmwareFile, manifestationTolerant).then(
                    () => {
                        page4.style.display = 'none';
                        fadeIn(page5, 500);
                        //logInfo("Done!");
                        setLogContext(null);
                        if (!manifestationTolerant) {
                            device.waitDisconnected(5000).then(
                                dev => {
                                    onDisconnect();
                                    device = null;
                                },
                                error => {
                                    // It didn't reset and disconnect for some reason...
                                    console.log("Device unexpectedly tolerated manifestation.");
                                }
                            );
                        }
                    },
                    error => {
                        logError(error);
                        setLogContext(null);
                    }
                )
            }

            //return false;
        //});
        };

        // Check if WebUSB is available
        if (typeof navigator.usb !== 'undefined') {
            navigator.usb.addEventListener("disconnect", onUnexpectedDisconnect);
            // Try connecting automatically
            if (fromLandingPage) {
                autoConnect(vid, serial);
            }
        } else {
            //statusDisplay.textContent = 'WebUSB not available.'
            console.log('WebUSB not available.');
            connectButton.disabled = true;
        }
    });
})();
