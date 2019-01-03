import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  Inject
} from "@angular/core";
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material";
import { WebWorkerService } from "ngx-web-worker";

interface Pixel {
  r: number;
  b: number;
  g: number;
  a: number;
}

class MImageData {
  public constructor(public imgData: any) {}

  public size(): [number, number] {
    return [this.imgData.width, this.imgData.height];
  }
  public getPixel(i: number, j: number): Pixel {
    const idx = j * this.imgData.width * 4 + i * 4;
    return {
      r: this.imgData.data[idx],
      b: this.imgData.data[idx + 1],
      g: this.imgData.data[idx + 2],
      a: this.imgData.data[idx + 3]
    };
  }

  public setPixel(i: number, j: number, px: Pixel) {
    const idx = j * this.imgData.width * 4 + i * 4;
    this.imgData.data[idx] = px.r;
    this.imgData.data[idx + 1] = px.g;
    this.imgData.data[idx + 2] = px.b;
    this.imgData.data[idx + 3] = px.a;
  }

  public getGray(i: number, j: number): number {
    const px = this.getPixel(i, j);
    return (px.r + px.g + px.b) / 3;
  }

  public setGray(i: number, j: number, v: number) {
    this.setPixel(i, j, { r: v, g: v, b: v, a: 255 });
  }
}

@Component({
  selector: "app-root",
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
  providers: [WebWorkerService]
})
export class AppComponent implements OnInit {
  public utfSymbol0 = "🍀😀";
  public utfSymbol1 = "🐳🐬🐋🐟";
  public imageUrl = "https://imgur.com/6cf1KE0";
  public outputLines: string[] = ["Not computed!"];
  public threshold: number = 200;
  public turn: boolean = false;

  private imageOrig = new Image();
  private imgDataOrig: MImageData;
  private imageBinary = new Image();
  private imgDataBinary: MImageData;

  private webWorkerResult: Promise<string[]>;

  public fontSize = 12;
  public lineHeight = 16;

  constructor(
    private dialog: MatDialog,
    private webWorkerService: WebWorkerService,
    @Inject("windowObject") private readonly window: Window
  ) {}

  @ViewChild("canvasOrig") canvasOrig: ElementRef;
  @ViewChild("canvasBinary") canvasBinary: ElementRef;

  ngOnInit() {
    console.log("ngOnInit");
    this.load();
  }

  public async load(extAdd = ".jpg"): Promise<void> {
    const orig = `${this.imageUrl}`;

    const replaceExt = (extAdd, failed = true) => {
      const regex = /.*imgur.*\/([a-zA-Z0-9]+)(\.[a-zA-Z0-9]+)?/gm;
      let m;
      while ((m = regex.exec(orig)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
          regex.lastIndex++;
        }
        if (m[2] && !failed) {
          extAdd = m[2];
        }
        this.imageUrl = `https://i.imgur.com/${m[1]}${extAdd}`;
      }

      console.log(`Load: ${this.imageUrl}`);
    };

    replaceExt(extAdd);

    this.loadCanvas()
      .then(null, error => {
        console.log(`Error: ${error} -> retry`);
        replaceExt(".jpg");
        return this.loadCanvas();
      })
      .then(null, error => {
        console.log(`Error: ${error} -> retry`);
        replaceExt(".jpeg");
        return this.loadCanvas();
      })
      .then(null, error => {
        console.log(`Error: ${error} -> retry`);
        replaceExt(".tif");
        return this.loadCanvas();
      })
      .then(null, error => {
        throw `Failed to load your imgur URL (CORS is probably preventing it!)`;
      })
      .then(
        () => this.updateFiltered(),
        error => {
          this.outputLines = [`${error}`];
        }
      );
  }

  private async loadCanvas(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.imageOrig = new Image();
      this.imageOrig.crossOrigin = "";
      this.imageOrig.onerror = () => reject("load failed");
      this.imageOrig.onload = () => {
        console.log(
          "Loaded canvas:",
          this.imageOrig.width,
          this.imageOrig.height
        );
        const c = this.canvasOrig.nativeElement;
        c.width = this.imageOrig.width;
        c.height = this.imageOrig.height;
        const ctx = this.canvasOrig.nativeElement.getContext("2d");
        ctx.drawImage(this.imageOrig, 0, 0);
        this.imgDataOrig = new MImageData(
          ctx.getImageData(0, 0, this.imageOrig.width, this.imageOrig.height)
        );
        resolve();
      };
      this.imageOrig.src = this.imageUrl;
    });
  }

  public async updateFiltered() {
    this.updateBinaryImage().then(
      () => this.computeOutput(),
      error => {
        this.outputLines = [`${error}`];
      }
    );
  }

  public async updateBinaryImage() {
    const img = this.imgDataOrig;
    if (!img) {
      throw "Image not loaded!";
    }
    const s = img.size();

    console.log("Update Binary Image", s);
    this.imgDataBinary = new MImageData(new ImageData(s[0], s[1]));

    for (let i = 0; i < s[0]; ++i) {
      for (let j = 0; j < s[1]; ++j) {
        let v = this.imgDataOrig.getGray(i, j);
        v = v <= this.threshold ? 0 : 255;
        this.imgDataBinary.setGray(i, j, v);
      }
    }
    this.canvasBinary.nativeElement.width = s[0];
    this.canvasBinary.nativeElement.height = s[1];
    this.canvasBinary.nativeElement
      .getContext("2d")
      .putImageData(this.imgDataBinary.imgData, 0, 0);
  }

  public async computeOutput() {
    return this.compute().then(
      value => {
        this.outputLines = value;
      },
      error => {
        this.outputLines = [`${error}`];
      }
    );
  }

  private async compute(): Promise<string[]> {
    if (this.webWorkerResult) {
      this.webWorkerService.terminate(this.webWorkerResult);
    }
    console.log("Compute Output: Start Webworker");
    this.webWorkerResult = this.webWorkerService.run(this.computeString, {
      imgData: this.imgDataBinary.imgData,
      symbols0: Array.from(this.utfSymbol0),
      symbols1: Array.from(this.utfSymbol1),
      turn: this.turn
    });

    return this.webWorkerResult;
  }

  /*
   * The webworker parallel function to compute
   * the stringified version of the binary image.
   */
  private computeString(inp: {
    imgData: ImageData;
    symbols0: Array<string>;
    symbols1: Array<string>;
    turn: boolean;
  }): string[] {
    // Workaround: Copy of defintion since prototypes are not serialized
    class MMImageData {
      public constructor(public imgData: any) {}

      public size(): [number, number] {
        return [this.imgData.width, this.imgData.height];
      }
      public getPixel(i: number, j: number): Pixel {
        const idx = j * this.imgData.width * 4 + i * 4;
        return {
          r: this.imgData.data[idx],
          b: this.imgData.data[idx + 1],
          g: this.imgData.data[idx + 2],
          a: this.imgData.data[idx + 3]
        };
      }

      public setPixel(i: number, j: number, px: Pixel) {
        const idx = j * this.imgData.width * 4 + i * 4;
        this.imgData.data[idx] = px.r;
        this.imgData.data[idx + 1] = px.g;
        this.imgData.data[idx + 2] = px.b;
        this.imgData.data[idx + 3] = px.a;
      }

      public getGray(i: number, j: number): number {
        const px = this.getPixel(i, j);
        return (px.r + px.g + px.b) / 3;
      }

      public setGray(i: number, j: number, v: number) {
        this.setPixel(i, j, { r: v, g: v, b: v, a: 255 });
      }
    }

    const img = new MMImageData(inp.imgData);
    const s = img.size();
    //console.log(`Webworker: Size: ${s}`);

    const symbols0 = inp.symbols0;
    const symbols1 = inp.symbols1;
    const turn = inp.turn;

    // Precondition:
    if (symbols0.length < 1 || symbols1.length < 1) {
      throw "Webworker: Enter some Symbols!";
    }
    //console.log(`Webworker: Symbols: ${symbols0.length}, ${symbols1.length}`);

    // Make a range, generators dont work in webworkers.
    const range = (start, end, step = 1) => {
      return [start, end, step];
    };

    // Make a for Loop, generators dont work in webworkers!
    const forLoop = (range, lambda) => {
      if (range[2] > 0) {
        for (let i = range[0]; i < range[1]; i += range[2]) {
          lambda(i);
        }
      } else {
        for (let i = range[0]; i >= range[1]; i += range[2]) {
          lambda(i);
        }
      }
    };

    let rangeX, rangeY, get;
    if (turn) {
      console.log("Webworker: Turn output!");
      rangeY = () => range(0, s[0]);
      rangeX = () => range(s[1] - 1, 0, -1);
      get = (x, y) => img.getGray(y, x);
    } else {
      rangeX = () => range(0, s[0]);
      rangeY = () => range(0, s[1]);
      get = (x, y) => img.getGray(x, y);
    }

    let o = [];

    forLoop(rangeY(), y => {
      let ss = "";

      forLoop(rangeX(), x => {
        let n = Math.trunc(Math.random() * symbols0.length);
        let k = Math.trunc(Math.random() * symbols1.length);
        if (get(x, y) === 255) {
          ss += symbols0[n];
        } else {
          ss += symbols1[k];
        }
      });
      o.push(ss);
    });

    //console.log("Webworker: Done!");
    return o;
  }

  public copyOutput(as = "text") {
    console.log("Copy");

    let listener = (e: ClipboardEvent) => {
      let clipboard = e.clipboardData || window["clipboardData"];
      if (as === "text") {
        clipboard.setData("text", this.outputLines.join("\n"));
      } else if (as === "html") {
        let s = `<div style="font-size:${this.fontSize}pt;line-height:${
          this.lineHeight
        }pt">`;
        this.outputLines.forEach((line, index) => {
          s += `<div style="text-overflow: unset; white-space: nowrap;">${line}</div>`;
        });
        s += "</div>";
        clipboard.setData("text", s);
      } else {
        throw "not implemented";
      }
      e.preventDefault();
    };

    document.addEventListener("copy", listener, false);
    document.execCommand("copy");
    document.removeEventListener("copy", listener, false);
  }

  public showHelp() {
    const dialogRef = this.dialog.open(DialogHelpComponent, {
      width: "70%"
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log("The dialog was closed");
    });
  }

  public openGithub() {
    this.window.open("http://www.github.com/gabyx/SmileyConverter", "_blank");
  }
}

@Component({
  selector: "dialog-help",
  templateUrl: "dialog-help.component.html"
})
export class DialogHelpComponent {
  constructor(
    public dialogRef: MatDialogRef<DialogHelpComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  onNoClick(): void {
    this.dialogRef.close();
  }
}
