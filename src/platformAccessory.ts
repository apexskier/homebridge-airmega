import { CharacteristicValue, PlatformAccessory } from "homebridge";

import { CowayHomebridgePlatform as CowayHomebridgePlatform } from "./platform";

export interface AccessoryContext {
  device: {
    barcode: string;
    dvcBrandCd: string;
    dvcModel: string;
    dvcNick: string;
    dvcTypeCd: string;
    prodName: string;
  };
}

enum FunctionId {
  Power = "0001",
  Mode = "0002",
  AirVolume = "0003",
  Light = "0007",
}

type FunctionValue = {
  [FunctionId.Power]: Power;
  [FunctionId.Mode]: Mode;
  [FunctionId.AirVolume]: AirVolume;
  [FunctionId.Light]: Light;
};

type FunctionI<T extends FunctionId> = {
  funcId: T;
  cmdVal: FunctionValue[T];
};

type ControlData = {
  devId: string;
  funcList: ReadonlyArray<FunctionI<FunctionId>>;
  dvcTypeCd: string;
  isMultiControl: boolean;
};

enum Power {
  On = "1",
  Off = "0",
}

enum Light {
  On = "2",
  AQIOff = "1",
  Off = "0",
}

// Combo of fan speed and mode
enum AirVolume {
  One = "1",
  Two = "2",
  Three = "3",
  Rapid = "5",
  // ??? = "9", // seen this once, not sure what it is
  Off = "0", // also shows for sleep
  Unknown = "99",
}

enum Mode {
  Manual = "0",
  Smart = "1",
  Sleep = "2",
  Off = "4",
  Rapid = "5",
  SmartEco = "6",
}

enum AirQuality {
  Excellent = "1",
  Good = "2",
  Fair = "3",
  Inferior = "4",
}

interface Response<Data> {
  code: "S1000" | string;
  message: "OK" | string;
  traceId: string; // I don't need this
  data: Data;
}

interface DeviceData {
  analysisStartDt: string; // "202502040140"
  analysisEndDt: string; // "202502040740"
  closeOffSceduleId: number; // -1 indicates none?
  closeOnSceduleId: number; // 49314
  elapsedHeartServiceDate: string; // ""
  filterList: ReadonlyArray<{
    changeCycle: string; // "3" | "12"
    cycleInfo: string; // "W" | "M"
    filterCode: string; // "3109143" | "3109144"
    filterName: string; // "극세사망 프리필터" | "Max2 필터"
    filterPer: number; // percent, as x out of 100;
    sort: number; // appears already sorted
    lastChangeDate: string; // e.g. "20250130"
  }>;
  IAQ: {
    // inside air quality?
    co2: string; // ""
    dustpm1: string; // ""
    dustpm10: string; // "15"
    dustpm25: string; // "1"
    humidity: string; // ""
    inairquality: string; // ""
    temperature: string; // ""
    vocs: string; // ""
    rpm: string; // ""
  };
  OAQ: {
    address: string; // ""
    humidity: string; // ""
    icon: string; // ""
    mainairgrade: string; // ""
    presenttime: string; // ""
    temp: string; // ""
  };
  schedules: ReadonlyArray<{
    scheId: number;
    dayOfWeek: ReadonlyArray<
      "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
    >;
    cmdValue: number; // -1 indicates none?
    startTime: string; // "0800" | "2100"
    endTime: string; // "0800" | "2100"
    lightOnOff: number; // 1 | 0 ?
    specialMode: number; // 0 ?
    movingMode: number; // 0 ?
    enabled: string; // "Y" | "N" ?
    devDtTimezn: string; // "-7.0"
    devDstTimezn: string;
  }>;
  pm10Graph: ReadonlyArray<{
    msrDt: string; // "202502040140"
    place: string; // "in"
    graphHighValue: string; // "5"
    graphValue: string; // "2"
  }>;
  prodStatus: {
    AICare: "";
    humidification: "";
    airVolume: AirVolume;
    dustPollution: "1";
    dustSensitivity: "2";
    light: Light;
    lightDetail: "";
    pollenMode: "";
    power: Power;
    prodMode: Mode;
    reservation: "";
    specialModeIndex: "";
    vocsGrade: "";
    silent: "";
    onTimer: "";
    purityFanAction: "";
    purityFanActionTime: "";
  };
  nextHeartService: "";
  humidity: 0;
  temperature: 0;
  netStatus: false;
  filterdeliveryList: [];
}

export class CowayPlatformAccessory {
  data: null | DeviceData = null;

  constructor(
    private readonly platform: CowayHomebridgePlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
  ) {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, "Coway")
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require("../package.json").version,
      )
      .setCharacteristic(
        this.platform.Characteristic.Name,
        this.accessory.context.device.dvcNick,
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        this.accessory.context.device.dvcModel,
      );

    const logSet =
      (label: string, fn: (value: CharacteristicValue) => Promise<void>) =>
      (value: CharacteristicValue) => {
        this.platform.log.debug(label, value);
        return fn(value);
      };

    const airPurifierService =
      this.accessory.getService(this.platform.Service.AirPurifier) ||
      this.accessory.addService(this.platform.Service.AirPurifier);
    airPurifierService
      .getCharacteristic(this.platform.Characteristic.Name)
      .setValue(this.accessory.context.device.dvcNick);
    airPurifierService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getActive)
      .onSet(
        logSet("setting power", async (value) =>
          this.controlDevice([
            {
              funcId: FunctionId.Power,
              cmdVal:
                value === this.platform.Characteristic.Active.ACTIVE
                  ? Power.On
                  : Power.Off,
            },
          ]),
        ),
      );
    airPurifierService
      .getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentAirPurifierState);
    airPurifierService
      .getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
      .onGet(this.getTargetAirPurifierState)
      .onSet(
        logSet("setting target state", async (value) =>
          this.controlDevice([
            {
              funcId: FunctionId.Mode,
              cmdVal:
                value ===
                this.platform.Characteristic.TargetAirPurifierState.AUTO
                  ? Mode.Smart
                  : Mode.Manual,
            },
          ]),
        ),
      );
    airPurifierService
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getRotationSpeed)
      .onSet(
        logSet("setting fan state", async (value) => {
          if (typeof value !== "number") {
            throw new Error(`unexpected value ${value}`);
          }

          let airVolume: AirVolume;
          if (value > 80) {
            airVolume = AirVolume.Rapid;
          } else if (value > 50) {
            airVolume = AirVolume.Three;
          } else if (value > 25) {
            airVolume = AirVolume.Two;
          } else if (value > 0) {
            airVolume = AirVolume.One;
          } else {
            airVolume = AirVolume.Off;
          }
          await this.controlDevice([
            {
              funcId: FunctionId.AirVolume,
              cmdVal: airVolume,
            },
          ]);
          // setting fan manually sets to manual mode
          airPurifierService.updateCharacteristic(
            this.platform.Characteristic.TargetAirPurifierState,
            this.platform.Characteristic.TargetAirPurifierState.MANUAL,
          );
        }),
      );

    const indoorAirQualityService =
      this.accessory.getServiceById(
        this.platform.Service.AirQualitySensor,
        "indoor",
      ) ||
      this.accessory.addService(
        this.platform.Service.AirQualitySensor,
        "Indoor Air Quality",
        "indoor",
      );
    indoorAirQualityService
      .getCharacteristic(this.platform.Characteristic.Name)
      .setValue("Indoor Air Quality");
    indoorAirQualityService
      .getCharacteristic(this.platform.Characteristic.AirQuality)
      .onGet(this.getAirQuality);
    indoorAirQualityService
      .getCharacteristic(this.platform.Characteristic.PM2_5Density)
      .onGet(this.getPm25Density);
    indoorAirQualityService
      .getCharacteristic(this.platform.Characteristic.PM10Density)
      .onGet(this.getPm10Density);

    const filters = {
      [0]: {
        subtype: "PreFilter",
        name: "Pre Filter",
      },
      [1]: {
        subtype: "MainFilter",
        name: "Main Filter",
      },
    };

    for (const [filterIndex, { subtype, name }] of Object.entries(filters)) {
      const filterService =
        this.accessory.getServiceById(
          this.platform.Service.FilterMaintenance,
          subtype,
        ) ||
        this.accessory.addService(
          this.platform.Service.FilterMaintenance,
          name,
          subtype,
        );
      filterService
        .getCharacteristic(this.platform.Characteristic.Name)
        .setValue(name);
      // not localized, so we don't use this
      // .onGet(
      //   () => this.guardedOnlineData().filterList[filterIndex].filterName
      // );
      filterService
        .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
        .onGet(() =>
          this.guardedOnlineData().filterList[filterIndex].filterPer < 20
            ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
            : this.platform.Characteristic.FilterChangeIndication.FILTER_OK,
        );
      filterService
        .getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
        .onGet(
          () => this.guardedOnlineData().filterList[filterIndex].filterPer,
        );
    }

    this.poll();
  }

  private getPm10Density = () => {
    if (this.guardedOnlineData().IAQ.dustpm10 === "") {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST,
      );
    }
    return parseInt(this.guardedOnlineData().IAQ.dustpm10, 10);
  };
  private getPm25Density = () => {
    if (this.guardedOnlineData().IAQ.dustpm25 === "") {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST,
      );
    }
    return parseInt(this.guardedOnlineData().IAQ.dustpm25, 10);
  };
  private getRotationSpeed = () => {
    this.platform.log.debug(
      `getCharacteristic.RotationSpeed`,
      this.guardedOnlineData().prodStatus.airVolume,
    );
    const airVolume = this.guardedOnlineData().prodStatus.airVolume;
    switch (airVolume) {
      case AirVolume.One:
        return 25;
      case AirVolume.Two:
        return 50;
      case AirVolume.Three:
        return 75;
      case AirVolume.Rapid:
        return 100;
      case AirVolume.Off:
        return 0;
      case AirVolume.Unknown:
      default:
        throw new Error(`unknown fan ${airVolume}`);
    }
  };
  private getTargetAirPurifierState = () => {
    this.platform.log.debug(
      `getCharacteristic.TargetAirPurifierState`,
      this.guardedOnlineData().prodStatus.prodMode,
    );
    switch (this.guardedOnlineData().prodStatus.prodMode) {
      case Mode.Smart:
      case Mode.SmartEco:
      case Mode.Rapid: // max speed until AQI is good for more than 5 minutes, then smart
      case Mode.Sleep:
        return this.platform.Characteristic.TargetAirPurifierState.AUTO;
      case Mode.Manual:
        return this.platform.Characteristic.TargetAirPurifierState.MANUAL;
      case Mode.Off:
        return this.platform.Characteristic.TargetAirPurifierState.AUTO;
    }
  };
  private getCurrentAirPurifierState = () => {
    this.platform.log.debug(
      `getCharacteristic.CurrentAirPurifierState`,
      this.guardedOnlineData().prodStatus,
    );
    const prodStatus = this.guardedOnlineData().prodStatus;
    if (prodStatus.prodMode === Mode.Off) {
      return this.platform.Characteristic.CurrentAirPurifierState.INACTIVE;
    }
    if (prodStatus.airVolume === AirVolume.Off) {
      return this.platform.Characteristic.CurrentAirPurifierState.IDLE;
    }
    return this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
  };
  private getActive = () => {
    this.platform.log.debug(
      `getCharacteristic.Active`,
      this.guardedOnlineData().prodStatus.power,
    );
    return this.guardedOnlineData().prodStatus.power === Power.On
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  };
  private getAirQuality = () => {
    this.platform.log.debug(
      `getCharacteristic.AirQuality`,
      this.guardedOnlineData().IAQ,
    );
    const airQuality = this.guardedOnlineData().IAQ.inairquality;
    switch (airQuality) {
      case AirQuality.Excellent:
        return this.platform.Characteristic.AirQuality.EXCELLENT;
      case AirQuality.Good:
        return this.platform.Characteristic.AirQuality.GOOD;
      case AirQuality.Fair:
        return this.platform.Characteristic.AirQuality.FAIR;
      case AirQuality.Inferior:
        return this.platform.Characteristic.AirQuality.INFERIOR;
      case "":
        this.platform.log.debug(`no air quality, falling back to pm`);
        break;
      default:
        this.platform.log.warn(
          `unknown air quality "${airQuality}", falling back to pm`,
        );
    }

    // fall back to pm2.5, pm10, or pm1
    const { dustpm25, dustpm10, dustpm1 } = this.guardedOnlineData().IAQ;
    let pmValue = -1;
    if (dustpm25 !== "") {
      pmValue = parseInt(dustpm25, 10);
    } else if (dustpm10 !== "") {
      pmValue = parseInt(dustpm10, 10);
    } else if (dustpm1 !== "") {
      pmValue = parseInt(dustpm1, 10);
    }

    if (pmValue >= 151) {
      return this.platform.Characteristic.AirQuality.POOR;
    }
    if (pmValue >= 56) {
      return this.platform.Characteristic.AirQuality.INFERIOR;
    }
    if (pmValue >= 36) {
      return this.platform.Characteristic.AirQuality.FAIR;
    }
    if (pmValue >= 12) {
      return this.platform.Characteristic.AirQuality.GOOD;
    }
    if (pmValue >= 0) {
      return this.platform.Characteristic.AirQuality.EXCELLENT;
    }
    throw new Error(`unknown dustpm: ${dustpm25} / ${dustpm10} / ${dustpm1}`);
  };

  private pushHomeKitUpdates = () => {
    const airPurifierService = this.accessory.getService(
      this.platform.Service.AirPurifier,
    );
    if (airPurifierService) {
      airPurifierService
        .getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState)
        .updateValue(this.getCurrentAirPurifierState());
      airPurifierService
        .getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
        .updateValue(this.getTargetAirPurifierState());
      airPurifierService
        .getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(this.getActive());
      airPurifierService
        .getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .updateValue(this.getRotationSpeed());
    }

    const indoorAirQualityService = this.accessory.getServiceById(
      this.platform.Service.AirQualitySensor,
      "indoor",
    );
    if (indoorAirQualityService) {
      indoorAirQualityService
        .getCharacteristic(this.platform.Characteristic.AirQuality)
        .updateValue(this.getAirQuality());
      if (this.guardedOnlineData().IAQ.dustpm25 !== "") {
        indoorAirQualityService
          .getCharacteristic(this.platform.Characteristic.PM2_5Density)
          .updateValue(this.getPm25Density());
      }
      if (this.guardedOnlineData().IAQ.dustpm10 === "") {
        indoorAirQualityService
          .getCharacteristic(this.platform.Characteristic.PM10Density)
          .updateValue(this.getPm10Density());
      }
    }
  };
  // ???
  private async comDevice() {
    const url = new URL(
      `https://iocareapi.iot.coway.com/api/v1/com/devices/${this.accessory.context.device.barcode}/control`,
    );
    url.searchParams.append("devId", this.accessory.context.device.barcode);
    url.searchParams.append("mqttDevice", "true"); // I wish
    url.searchParams.append(
      "dvcBrandCd",
      this.accessory.context.device.dvcBrandCd,
    );
    url.searchParams.append(
      "dvcTypeCd",
      this.accessory.context.device.dvcTypeCd,
    );
    url.searchParams.append("prodName", this.accessory.context.device.prodName);

    return (await (await this.platform.fetch(url)).json()) as Response<{
      controlStatus: {
        [FunctionId.Power]: Power; // "1"
        [FunctionId.Mode]: Mode; // "1"
        [FunctionId.AirVolume]: AirVolume; // "1"
        [FunctionId.Light]: Light;
        "0008": string; // "0"
        "000A": string; // "2"
        "000E": string; // "1"
        "0012": string; // "0"
        "0018": string; // "0"
        "0019": string; // "0"
        "0021": string; // "0"
        "0024": string; // "0"
        "0025": string; // "0"
        "002F": string; // "1"
        offTimer: string; // "0"
        originDt: string; // "1738704280790"
        serial: string; // "41102F9R2481600525"
      };
      lastBubbleSterTime: string; // ""
      lastDrainageTime: string; // ""
      lastSterTime: string; // ""
      errorCode: string; // ""
      errorYn: boolean; // false
      netStatus: boolean; // true
      waterLevel: number; // 0
    }>;
  }

  private async controlDevice(commands: Array<FunctionI<FunctionId>>) {
    if (!commands[FunctionId.Light]) {
      const comDV = await this.comDevice();
      commands.push({
        funcId: FunctionId.Light,
        cmdVal: comDV.data.controlStatus[FunctionId.Light],
      });
    }
    const body = JSON.stringify({
      devId: this.accessory.context.device.barcode,
      funcList: commands,
      dvcTypeCd: this.accessory.context.device.dvcTypeCd,
      isMultiControl: false,
    } satisfies ControlData);
    this.platform.log.debug("controlling device", body);
    await this.platform.fetch(
      `https://iocareapi.iot.coway.com/api/v1/com/control-device`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      },
    );
    await this.updateStatus();
  }

  private poll() {
    this.updateStatus()
      .catch((err) => {
        this.platform.log.error(
          "update status error",
          err,
          (err as Error).stack,
        );
      })
      .then(() => setTimeout(this.poll.bind(this), 10 * 1000));
  }

  private async updateStatus() {
    const url = new URL(
      `https://iocareapi.iot.coway.com/api/v1/air/devices/${this.accessory.context.device.barcode}/home`,
    );
    // url.searchParams.append('admdongCd', 'US');
    url.searchParams.append("barcode", this.accessory.context.device.barcode);
    url.searchParams.append(
      "dvcBrandCd",
      this.accessory.context.device.dvcBrandCd,
    );
    // url.searchParams.append('prodName', this.accessory.context.device.prodName);
    // url.searchParams.append('zipCode', '');
    // url.searchParams.append('resetDttm', '');
    // url.searchParams.append('deviceType', this.accessory.context.device.dvcTypeCd);
    url.searchParams.append("mqttDevice", "true"); // TODO: this could mean local control without network connection is possible
    url.searchParams.append("orderNo", "undefined");
    url.searchParams.append("membershipYn", "N");
    // url.searchParams.append('selfYn', 'N');

    const { data } = (await (
      await this.platform.fetch(url)
    ).json()) as Response<DeviceData>;
    this.platform.log.debug("updated status");
    this.data = data;
    this.pushHomeKitUpdates();
  }

  private guardedOnlineData(): DeviceData {
    if (this.data === null) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
    return this.data;
  }
}
