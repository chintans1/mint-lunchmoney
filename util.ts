import papaparse from "papaparse";
import fs from "fs";
import { MintTransaction } from "./models/mintTransaction";

export const readJSONFile = (path: string): any | null => {
  if (fs.existsSync(path)) {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  }

  return null;
};

// TODO should type the resulting object here for better checking downstream
export const readCSV = async (filePath: string): Promise<MintTransaction[]> => {
  const csvFile = fs.readFileSync(filePath);
  const csvData = csvFile.toString();

  return new Promise((resolve) => {
    papaparse.parse(csvData, {
      header: true,
      skipEmptyLines: true,
      // 'Original Description' => 'OriginalDescription'
      transformHeader: (header: string) => header.replace(/\s/g, ""),
      complete: (results) => {
        console.log("read data");
        return resolve(results.data);
      },

    } as papaparse.ParseConfig<MintTransaction>);
  });
};

export const writeCSV = (csvRows: any, filePath: string) => {
  const csvContent = papaparse.unparse(csvRows);
  fs.writeFileSync(filePath, csvContent);
};

export function prettyJSON(json: Object, returnString = false): string {
  return JSON.stringify(json, null, 2);
}

export function parseBoolean(userInput: String): boolean {
  userInput = userInput.trim();
  return userInput === "y" || userInput === "Y";
}
