# Android direct thermal receipts

The receipt screen has a per-device **Print method** setting on Android:

- **Browser print** keeps the existing HTTPS receipt page and system print dialog.
- **Direct thermal (RawBT app)** sends ESC/POS bytes to the installed RawBT app from the user's Print receipt click. It does not open a browser print preview or generate a PDF page.
- The separate **Browser print** button always uses the browser, even when direct mode is selected.

## Set up a tablet

1. Install the official RawBT app: https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter
2. In RawBT, configure the actual printer, connection (Bluetooth, USB, or Wi-Fi/Ethernet), and compatible ESC/POS driver. USB depends on tablet/OTG support; Wi-Fi uses the printer's network address and supported port. These are configured in RawBT, not stored in the trading database.
3. Match the paper width in the software and RawBT. The app generates Font A text at 32 columns for 58 mm and 48 columns for 80 mm. Verify alignment on the specific printer model.
4. Disable RawBT's preview if enabled. Initial Android app-opening prompts/permissions can still appear.
5. Open a buying receipt in the software. Select **Direct thermal (RawBT app)**, then use **Test printer**. This prints a clearly marked sample and does not create or change a transaction.
6. Once the test is readable and the feed is appropriate, use **Print receipt** for saved receipts.

Exact VOZY/Xprinter models have not yet been provided. Compatibility and physical output must be tested on each printer; simulated tests cannot verify Bluetooth, USB, network connectivity, feed distance or print quality. RawBT's listing includes in-app purchases and says the unlicensed version adds a notice to output; check the app's current terms before client rollout.

## Receipt behavior

Receipts contain the same saved purchase data and rounded displayed amounts as browser receipts. Direct mode uses printer-native text and wraps to the selected width. Accented Latin characters are normalized; unsupported characters are replaced with spaces. No fixed page length, cut, or cash-drawer commands are sent. Two additional newline feeds follow the receipt.

Data is sent to the local Android app via its documented raw base64 intent. It is not uploaded to a new print server or stored in a public URL. Receipt field control characters are removed before generating printer commands.

The bridge does not return a delivery acknowledgement to the webpage. The UI says **Sent to RawBT**, never **Printed successfully**. There is no automatic retry or automatic browser fallback: those could duplicate a receipt that was already printed. If a job does not appear, check RawBT and the printer before retrying or using the manual Browser print fallback.

## References

- Official raw intent integration example: https://github.com/402d/rawbt.402d.ru/blob/master/app2/index.php
- Raw byte integration example: https://github.com/402d/RawBt-and-ESCPOS-coffee
- Supported connections and current app terms: https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter
