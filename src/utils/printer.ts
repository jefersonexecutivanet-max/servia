export type PrinterType = "usb" | "bluetooth" | "network" | "browser";
export type PaperWidth = 58 | 80;

// Configuração da impressora da cozinha (nível restaurante)
export interface RestaurantPrinterSettings {
  printerEnabled: boolean;
  autoPrintOrders: boolean;
  printerType: PrinterType;
  printerIp: string;
  printerPort: number;
  paperWidth: PaperWidth;
}

// Configuração da impressora do caixa (nível usuário)
export interface UserPrinterSettings {
  printerEnabled: boolean;
  printerType: PrinterType;
  printerIp: string;
  printerPort: number;
  paperWidth: PaperWidth;
}

export function getRestaurantPrinterSettings(): RestaurantPrinterSettings {
  const settingsStr = localStorage.getItem("servia_restaurant_printer");
  if (settingsStr) {
    try {
      const parsed = JSON.parse(settingsStr);
      return {
        printerEnabled: parsed.printerEnabled ?? true,
        autoPrintOrders: parsed.autoPrintOrders ?? true,
        printerType: "browser",
        printerIp: parsed.printerIp ?? "",
        printerPort: parsed.printerPort ?? 9100,
        paperWidth: parsed.paperWidth ?? 80,
      };
    } catch (error) {
      console.error("Erro ao carregar configurações da impressora do restaurante:", error);
    }
  }
  return {
    printerEnabled: true,
    autoPrintOrders: true,
    printerType: "browser",
    printerIp: "",
    printerPort: 9100,
    paperWidth: 80,
  };
}

export function saveRestaurantPrinterSettings(settings: RestaurantPrinterSettings): void {
  localStorage.setItem("servia_restaurant_printer", JSON.stringify(settings));
}

export function getUserPrinterSettings(): UserPrinterSettings {
  const settingsStr = localStorage.getItem("servia_user_printer");
  if (settingsStr) {
    try {
      const parsed = JSON.parse(settingsStr);
      return {
        printerEnabled: parsed.printerEnabled ?? true,
        printerType: "browser",
        printerIp: parsed.printerIp ?? "",
        printerPort: parsed.printerPort ?? 9100,
        paperWidth: parsed.paperWidth ?? 80,
      };
    } catch (error) {
      console.error("Erro ao carregar configurações da impressora do usuário:", error);
    }
  }
  return {
    printerEnabled: true,
    printerType: "browser",
    printerIp: "",
    printerPort: 9100,
    paperWidth: 80,
  };
}

export function saveUserPrinterSettings(settings: UserPrinterSettings): void {
  localStorage.setItem("servia_user_printer", JSON.stringify(settings));
}

export function shouldAutoPrintOrders(): boolean {
  const settings = getRestaurantPrinterSettings();
  return settings.printerEnabled && settings.autoPrintOrders;
}

export function generatePrintContent(
  title: string,
  orderNumber: string,
  tableNumber: number,
  items: Array<{ name: string; quantity: number; price: number; extras?: string[]; notes?: string }>,
  total: number,
  additionalInfo?: { [key: string]: string },
  paperWidth: PaperWidth = 80,
): string {
  const fontSize = paperWidth === 58 ? "10px" : "12px";

  return `
    <html>
    <head>
      <title>${title}</title>
      <style>
        body {
          font-family: 'Courier New', monospace;
          font-size: ${fontSize};
          padding: 10px;
          margin: 0;
          width: ${paperWidth}mm;
        }
        .header {
          text-align: center;
          margin-bottom: 15px;
          border-bottom: 2px dashed #000;
          padding-bottom: 8px;
        }
        .header h2 {
          margin: 0;
          font-size: ${parseInt(fontSize) + 4}px;
        }
        .header p {
          margin: 3px 0;
        }
        .info {
          margin-bottom: 12px;
        }
        .info p {
          margin: 4px 0;
        }
        .items {
          margin-bottom: 12px;
        }
        .items h3 {
          margin: 0 0 8px;
          font-size: ${parseInt(fontSize) + 2}px;
          border-bottom: 1px solid #000;
          padding-bottom: 4px;
        }
        .item {
          margin: 6px 0;
          line-height: 1.4;
        }
        .item small {
          display: block;
          font-size: ${parseInt(fontSize) - 2}px;
          color: #333;
          margin-top: 2px;
        }
        .total {
          border-top: 2px dashed #000;
          padding-top: 8px;
          margin-top: 12px;
          font-size: ${parseInt(fontSize) + 2}px;
          font-weight: bold;
          text-align: right;
        }
        .footer {
          margin-top: 15px;
          text-align: center;
          font-size: ${parseInt(fontSize) - 2}px;
          border-top: 1px dashed #000;
          padding-top: 8px;
        }
        .footer p {
          margin: 3px 0;
        }
        @media print {
          body {
            width: ${paperWidth}mm;
          }
          @page {
            margin: 0;
            size: ${paperWidth}mm auto;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>${title}</h2>
        <p>#${orderNumber}</p>
        <p>Mesa ${tableNumber}</p>
        <p>${new Date().toLocaleString("pt-BR")}</p>
      </div>

      ${additionalInfo ? `
      <div class="info">
        ${Object.entries(additionalInfo).map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`).join("")}
      </div>
      ` : ""}

      <div class="items">
        <h3>ITENS:</h3>
        ${items.map(item => `
          <div class="item">
            ${item.quantity}x ${item.name} - ${formatCurrency(item.price)}
            ${item.extras?.length ? `<small>+ ${item.extras.join(", ")}</small>` : ""}
            ${item.notes ? `<small>Obs: ${item.notes}</small>` : ""}
          </div>
        `).join("")}
      </div>

      <div class="total">
        TOTAL: ${formatCurrency(total)}
      </div>

      <div class="footer">
        <p>Servia - Sistema de Gestão</p>
        <p>${new Date().toLocaleString("pt-BR")}</p>
      </div>
    </body>
    </html>
  `;
}

export async function printContent(htmlContent: string, settings?: RestaurantPrinterSettings | UserPrinterSettings): Promise<boolean> {
  const printerSettings = settings || getRestaurantPrinterSettings();
  if (!printerSettings.printerEnabled) return false;

  let frame: HTMLIFrameElement | undefined;
  try {
    frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "1px",
      height: "1px",
      border: "0",
      opacity: "0",
      pointerEvents: "none",
    });

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      let cleanupTimer = 0;
      const cleanup = () => {
        window.clearTimeout(cleanupTimer);
        frame?.remove();
      };
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        resolve(success);
      };

      frame!.onload = () => {
        const printWindow = frame?.contentWindow;
        if (!printWindow) {
          cleanup();
          finish(false);
          return;
        }
        printWindow.addEventListener("afterprint", cleanup, { once: true });
        cleanupTimer = window.setTimeout(cleanup, 120_000);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          try {
            printWindow.focus();
            printWindow.print();
            finish(true);
          } catch (printError) {
            console.error("Falha ao abrir a impressao do navegador:", printError);
            cleanup();
            finish(false);
          }
        }));
      };

      frame!.srcdoc = htmlContent;
      document.body.appendChild(frame!);
    });
  } catch (error) {
    frame?.remove();
    console.error("Erro ao imprimir:", error);
    return false;
  }
}

export async function testPrinter(): Promise<boolean> {
  const settings = getRestaurantPrinterSettings();
  const testContent = generatePrintContent(
    "TESTE DE IMPRESSÃO",
    "TEST-" + Date.now().toString().slice(-6),
    0,
    [{ name: "Item de teste", quantity: 1, price: 0 }],
    0,
    { "Largura do papel": `${settings.paperWidth}mm`, "Tipo": settings.printerType },
    settings.paperWidth,
  );
  return printContent(testContent, settings);
}
import { formatCurrency } from "./format";
