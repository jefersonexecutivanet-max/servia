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
        printerType: parsed.printerType ?? "browser",
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
        printerType: parsed.printerType ?? "browser",
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export async function printContent(htmlContent: string, settings?: RestaurantPrinterSettings | UserPrinterSettings): Promise<boolean> {
  const printerSettings = settings || getRestaurantPrinterSettings();

  if (!printerSettings.printerEnabled) {
    console.warn("Impressora desabilitada nas configurações");
    return false;
  }

  try {
    switch (printerSettings.printerType) {
      case "usb":
        if ("usb" in navigator) {
          const usb = (navigator as any).usb;
          const devices = await usb.getDevices();
          if (devices.length === 0) {
            console.error("Nenhuma impressora USB encontrada");
            return false;
          }
          // Implementar comunicação USB real aqui
          console.log("Impressão USB:", devices);
          return true;
        }
        console.error("WebUSB não suportado");
        return false;

      case "bluetooth":
        if ("bluetooth" in navigator) {
          // Implementar comunicação Bluetooth real aqui
          console.log("Impressão Bluetooth");
          return true;
        }
        console.error("Web Bluetooth não suportado");
        return false;

      case "network":
        if (!printerSettings.printerIp) {
          console.error("IP da impressora não configurado");
          return false;
        }
        // Implementar comunicação de rede real aqui
        console.log(`Impressão de rede: ${printerSettings.printerIp}:${printerSettings.printerPort}`);
        return true;

      case "browser":
      default:
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          console.error("Não foi possível abrir janela de impressão");
          return false;
        }
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.print();
        return true;
    }
  } catch (error) {
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
