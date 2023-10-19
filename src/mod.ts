/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/brace-style */
import { DependencyContainer } from "tsyringe";
import {StaticRouterModService} from "@spt-aki/services/mod/staticRouter/StaticRouterModService";
import {SaveServer} from "@spt-aki/servers/SaveServer";
import { IPostAkiLoadMod } from "@spt-aki/models/external/IPostAkiLoadMod";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import { HashUtil } from "@spt-aki/utils/HashUtil";
import { JsonUtil } from "@spt-aki/utils/JsonUtil";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { BaseClasses } from "@spt-aki/models/enums/BaseClasses";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";
//import { LogBackgroundColor } from "@spt-aki/models/spt/logging/LogBackgroundColor";
import { Debug } from "./debug";

import * as config from "../config/config.json";
import { ITrader } from "@spt-aki/models/eft/common/tables/ITrader";

class Mod implements IPostAkiLoadMod, IPostDBLoadMod, IPreAkiLoadMod {
    logger: ILogger
    modName: string
    modVersion: string
    container: DependencyContainer;

    constructor() {
        this.modName = "Gilded Key Storage";
    }

    public postAkiLoad(container: DependencyContainer): void {
        this.container = container;
    }


    public preAkiLoad(container: DependencyContainer): void {
        const staticRouterModService = container.resolve<StaticRouterModService>("StaticRouterModService")
        const saveServer = container.resolve<SaveServer>("SaveServer")
        const logger = container.resolve<ILogger>("WinstonLogger")
        const debugUtil = new Debug()

        debugUtil.giveProfileAllKeysAndGildedCases(staticRouterModService, saveServer, logger)
        debugUtil.removeAllDebugInstanceIdsFromProfile(staticRouterModService, saveServer)
    }

    public postDBLoad(container: DependencyContainer): void {
        this.logger = container.resolve<ILogger>("WinstonLogger");
        this.logger.log(`[${this.modName}] : Mod loading`, LogTextColor.GREEN);
        const debugUtil = new Debug()
        const jsonUtil = container.resolve<JsonUtil>("JsonUtil");
        const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const dbTables = databaseServer.getTables();
        const restrInRaid = dbTables.globals.config.RestrictionsInRaid;
        const dbTemplates = dbTables.templates
        const dbTraders = dbTables.traders
        const dbItems = dbTemplates.items
        const dbLocales = dbTables.locales.global["en"]

        
        this.combatibilityThings(dbItems)

        this.createCase(container, config["Golden Key Pouch"], dbTables, jsonUtil);
        this.createCase(container, config["Golden Keychain Mk. I"], dbTables, jsonUtil);
        this.createCase(container, config["Golden Keychain Mk. II"], dbTables, jsonUtil);
        this.createCase(container, config["Golden Keychain Mk. III"], dbTables, jsonUtil);
        this.createCase(container, config["Golden Keycard Case"], dbTables, jsonUtil);

        this.pushSupportiveBarters(dbTraders)
        this.makeKeysWeightlessCommaDiscardableAndHaveNoUseLimit(dbItems)
        this.setLabsCardInRaidLimit(restrInRaid, 9)

        debugUtil.logMissingKeys(this.logger, dbItems, dbLocales)
    }

    pushSupportiveBarters(dbTraders: Record<string, ITrader>):void{
        const additionalBarters = config["Additional Barter Trades"];
        for (const bart in additionalBarters){
            this.pushToTrader(additionalBarters[bart], additionalBarters[bart].id, dbTraders);
        }
    }

    setLabsCardInRaidLimit(restrInRaid:any, limitAmount:number):void{
        if (restrInRaid === undefined) return

        //restrInRaid type set to any to shut the linter up because the type doesn't include MaxIn... props
        //set labs access card limit in raid to 9 so the keycard case can be filled while on pmc
        for (const restr in restrInRaid){
            const thisRestriction = restrInRaid[restr]
            if (thisRestriction.TemplateId === "5c94bbff86f7747ee735c08f"){
                thisRestriction.MaxInLobby = limitAmount;
                thisRestriction.MaxInRaid = limitAmount;
            }
        }
    }

    makeKeysWeightlessCommaDiscardableAndHaveNoUseLimit(dbItems){
        if (!config.weightless_keys && !config.no_key_use_limit && !config.keys_are_discardable) return
        for (const it in dbItems){
            const itemProps = dbItems[it]._props

            if (dbItems[it]._parent === BaseClasses.KEY_MECHANICAL || dbItems[it]._parent ===  BaseClasses.KEYCARD){

                if (config.weightless_keys){
                    itemProps.Weight = 0.0;
                }

                //this sets labs key uses to infinite, but they still are consumed when leaving labs so the affect is only cosmetic
                if (config.no_key_use_limit){
                    itemProps.MaximumNumberOfUsage = 0;
                }
                
                if (config.keys_are_discardable){
                    itemProps.DiscardLimit = -1
                }
            }
        }
    }

    combatibilityThings(dbItems):void{
        //do a compatibility correction to make this mod work with other mods with destructive code (cough, SVM, cough)
        //basically just add the filters element back to backpacks and secure containers if they've been removed by other mods
        const compatFiltersElement = [{ "Filter": [BaseClasses.ITEM], "ExcludedFilter": [""] }];

        for (const i in dbItems){
            if (
                dbItems[i]._parent === BaseClasses.BACKPACK ||
                dbItems[i]._parent === BaseClasses.VEST ||
                (dbItems[i]._parent === "5448bf274bdc2dfc2f8b456a"  /*Mob Container ID*/  && i !== "5c0a794586f77461c458f892")
            ) {
                if (dbItems[i]._props.Grids[0]._props.filters[0] === undefined){
                    dbItems[i]._props.Grids[0]._props.filters = compatFiltersElement;
                }
            }
        }
    }

    createCase(container, config, tables, jsonUtil){
        const handbook = tables.templates.handbook;
        const locales = Object.values(tables.locales.global) as Record<string, string>[];
        const itemID = config.id
        const itemPrefabPath = `CaseBundles/${itemID}.bundle`
        let item;

        //clone a case
        if (config.case_type === "container"){
            item = jsonUtil.clone(tables.templates.items["5d235bb686f77443f4331278"]);
            item._props.IsAlwaysAvailableForInsurance = true;
            item._props.DiscardLimit = -1;
        }

        if (config.case_type === "slots"){
            item = jsonUtil.clone(tables.templates.items["5a9d6d00a2750c5c985b5305"]);
            item._props.IsAlwaysAvailableForInsurance = true;
            item._props.DiscardLimit = -1;
            item._props.ItemSound = config.sound;
        }

        item._id = itemID;
        item._props.Prefab.path = itemPrefabPath;

        //call methods to set the grid or slot cells up
        if (config.case_type === "container"){
            item._props.Grids = this.createGrid(container, itemID, config);
        }
        if (config.case_type === "slots"){
            item._props.Slots = this.createSlot(container, itemID, config);
        }
        
        //set external size of the container:
        item._props.Width = config.ExternalSize.width;
        item._props.Height = config.ExternalSize.height;

        tables.templates.items[itemID] = item;
        
        //add locales
        for (const locale of locales) {
            locale[`${itemID} Name`] = config.item_name;
            locale[`${itemID} ShortName`] = config.item_short_name;
            locale[`${itemID} Description`] = config.item_description;
        }

        let price = config.flea_price

        if (config.flea_banned){
            price = 0
        }

        handbook.Items.push(
            {
                "Id": itemID,
                "ParentId": "5b5f6fa186f77409407a7eb7",
                "Price": price
            }
        );

        //allow or disallow in secure containers, backpacks, other specific items per the config
        this.allowIntoContainers(
            itemID,
            tables.templates.items,
            config.allow_in_secure_containers,
            config.allow_in_backpacks,
            config.case_allowed_in,
            config.case_disallowed_in
        );

        this.pushToTrader(config, itemID, tables.traders);

        //log success!
        this.logger.log(`[${this.modName}] : ${config.item_name} loaded! Hooray!`, LogTextColor.GREEN);
    }

    pushToTrader(config, itemID:string, dbTraders: Record<string, ITrader>){
        const traderIDs = {
            "mechanic": "5a7c2eca46aef81a7ca2145d",
            "skier": "58330581ace78e27b8b10cee",
            "peacekeeper": "5935c25fb3acc3127c3d8cd9",
            "therapist": "54cb57776803fa99248b456e",
            "prapor": "54cb50c76803fa8b248b4571",
            "jaeger": "5c0647fdd443bc2504c2d371",
            "ragman": "5ac3b934156ae10c4430e83c"
        };

        /*
        const currencyIDs = {
            "roubles": "5449016a4bdc2d6f028b456f",
            "euros": "569668774bdc2da2298b4568",
            "dollars": "5696686a4bdc2da3298b456a"
        };
        */

        //add to config trader's inventory
        let traderToPush = config.trader;
        Object.entries(traderIDs).forEach(([key, val]) => {
            if (key === config.trader){
                traderToPush = val;
            }
        })
        const trader = dbTraders[traderToPush];

        trader.assort.items.push({
            "_id": itemID,
            "_tpl": itemID,
            "parentId": "hideout",
            "slotId": "hideout",
            "upd":
            {
                "UnlimitedCount": config.unlimited_stock,
                "StackObjectsCount": config.stock_amount
            }
        });

        const barterTrade: any = [];
        const configBarters = config.barter;

        for (const barter in configBarters){
            barterTrade.push(configBarters[barter]);
        }

        trader.assort.barter_scheme[itemID] = [barterTrade];
        trader.assort.loyal_level_items[itemID] = config.trader_loyalty_level;
    }

    allowIntoContainers(itemID, items, secContainers, backpacks, addAllowedIn, addDisallowedIn): void {
        for (const item in items){
            
            //disallow in backpacks
            if (backpacks === false){
                this.allowOrDisallowIntoCaseByParent(itemID, "exclude", items[item], BaseClasses.BACKPACK);
            }

            //allow in secure containers
            if (secContainers){
                this.allowOrDisallowIntoCaseByParent(itemID, "include", items[item], "5448bf274bdc2dfc2f8b456a");
            }

            //disallow in additional specific items
            for (const configItem in addDisallowedIn){
                if (addDisallowedIn[configItem] === items[item]._id){
                    this.allowOrDisallowIntoCaseByID(itemID, "exclude", items[item]);
                }

            }

            //allow in additional specific items
            for (const configItem in addAllowedIn){
                if (addAllowedIn[configItem] === items[item]._id){
                    this.allowOrDisallowIntoCaseByID(itemID, "include", items[item]);
                }
            }
        }
    }

    allowOrDisallowIntoCaseByParent(customItemID, includeOrExclude, currentItem, caseParent): void {

        //exclude custom case in all items of caseToApplyTo parent
        if (includeOrExclude === "exclude"){
            for (const gridKey in currentItem._props.Grids){
                if (currentItem._parent === caseParent && currentItem._id !== "5c0a794586f77461c458f892"){
                    if (currentItem._props.Grids[0]._props.filters[0].ExcludedFilter === undefined){
                        currentItem._props.Grids[0]._props.filters[0]["ExcludedFilter"] = [customItemID];
                    } else {                 
                        currentItem._props.Grids[gridKey]._props.filters[0].ExcludedFilter.push(customItemID)

                    }
                }
            }
        }

        //include custom case in all items of caseToApplyTo parent
        if (includeOrExclude === "include"){
            if (currentItem._parent === caseParent && currentItem._id !== "5c0a794586f77461c458f892"){
                if (currentItem._props.Grids[0]._props.filters[0].Filter === undefined){
                    currentItem._props.Grids[0]._props.filters[0]["Filter"] = [customItemID];
                } else {
                    currentItem._props.Grids[0]._props.filters[0].Filter.push(customItemID)
                }
            }
        }
    }

    allowOrDisallowIntoCaseByID(customItemID, includeOrExclude, currentItem): void {
    
        //exclude custom case in specific item of caseToApplyTo id
        if (includeOrExclude === "exclude"){
            if (currentItem._props.Grids[0]._props.filters[0].ExcludedFilter === undefined){
                currentItem._props.Grids[0]._props.filters[0]["ExcludedFilter"] = [customItemID];
            } else {
                currentItem._props.Grids[0]._props.filters[0].ExcludedFilter.push(customItemID)
            }
        }

        //include custom case in specific item of caseToApplyTo id
        if (includeOrExclude === "include"){
            if (currentItem._props.Grids[0]._props.filters[0].Filter === undefined){
                currentItem._props.Grids[0]._props.filters[0]["Filter"] = [customItemID];
            } else {
                currentItem._props.Grids[0]._props.filters[0].Filter.push(customItemID)
            }
        }      
    }

    createGrid(container, itemID, config) {
        const grids = [];
        let cellHeight = config.InternalSize["vertical_cells"];
        let cellWidth = config.InternalSize["horizontal_cells"];
        const inFilt = config.included_filter;
        const exFilt = config.excluded_filter;
        const UCcellToApply = config.cell_to_apply_filters_to;
        const UCinFilt = config.unique_included_filter;
        const UCexFilt = config.unique_excluded_filter;

        //if inFilt is empty set it to the base item id so the case will accept all items
        if (inFilt.length === 1 && inFilt[0] === ""){
            inFilt[0] = BaseClasses.ITEM;
        }
        if (UCinFilt.length === 1 && UCinFilt[0] === ""){
            UCinFilt[0] = BaseClasses.ITEM;
        }

        //if num of width and height cells are not the same, set case to 1x1 and throw warning msg
        if (cellHeight.length !== cellWidth.length){
            cellHeight = [1];
            cellWidth = [1];
            this.logger.log(`[${this.modName}] : WARNING: number of internal and vertical cells must be the same.`, LogTextColor.RED);
            this.logger.log(`[${this.modName}] : WARNING: setting ${config.item_name} to be 1 1x1 cell.`, LogTextColor.RED);

        }

        for (let i = 0; i < cellWidth.length; i++) {
            if ((i === UCcellToApply-1) || (UCcellToApply[i] === ("y" || "Y"))){
                grids.push(this.generateGridColumn(container, itemID, "column"+i, cellWidth[i], cellHeight[i], UCinFilt, UCexFilt));
            } else {
                grids.push(this.generateGridColumn(container, itemID, "column"+i, cellWidth[i], cellHeight[i], inFilt, exFilt));
            }
        }
        return grids;
    }

    createSlot(container, itemID, config) {
        const slots = [];
        const configSlots = config.slot_ids;

        for (let i = 0; i < configSlots.length; i++){
            slots.push(this.generateSlotColumn(container, itemID, "mod_mount_"+i, configSlots[i]));
        }
        return slots;
    }

    generateGridColumn(container: DependencyContainer, itemID, name, cellH, cellV, inFilt, exFilt) {
        const hashUtil = container.resolve<HashUtil>("HashUtil")
        return {
            "_name": name,
            "_id": hashUtil.generate(),
            "_parent": itemID,
            "_props": {
                "filters": [
                    {
                        "Filter": [...inFilt],
                        "ExcludedFilter": [...exFilt]
                    }
                ],
                "cellsH": cellH,
                "cellsV": cellV,
                "minCount": 0,
                "maxCount": 0,
                "maxWeight": 0,
                "isSortingTable": false
            }
        };
    }

    generateSlotColumn(container: DependencyContainer, itemID, name, configSlot) {
        const hashUtil = container.resolve<HashUtil>("HashUtil")
        return {
            "_name": name,
            "_id": hashUtil.generate(),
            "_parent": itemID,
            "_props": {
                "filters": [
                    {
                        "Filter": [configSlot],
                        "ExcludedFilter": [""]
                    }
                ],
                "_required": false,
                "_mergeSlotWithChildren": false
            }
        };
    }
}

module.exports = { mod: new Mod() }
