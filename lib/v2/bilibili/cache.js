const got = require('@/utils/got');
const utils = require('./utils');
const cheerio = require('cheerio');
const config = require('@/config').value;
const logger = require('@/utils/logger');
const puppeteer = require('@/utils/puppeteer');

let disableConfigCookie = false;
module.exports = {
    getCookie: (ctx) => {
        if (!disableConfigCookie && Object.keys(config.bilibili.cookies).length > 0) {
            return config.bilibili.cookies[Object.keys(config.bilibili.cookies)[Math.floor(Math.random() * Object.keys(config.bilibili.cookies).length)]];
        }
        const key = 'bili-cookie';
        return ctx.cache.tryGet(key, async () => {
            const browser = await puppeteer({
                stealth: true,
            });
            const page = await browser.newPage();
            const waitForRequest = new Promise((resolve) => {
                page.on('requestfinished', async (request) => {
                    if (request.url() === 'https://api.bilibili.com/x/internal/gaia-gateway/ExClimbWuzhi') {
                        const cookies = await page.cookies();
                        const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
                        resolve(cookieString);
                    }
                });
            });
            await page.goto('https://space.bilibili.com/1/dynamic');
            const cookieString = await waitForRequest;
            logger.debug(`Got bilibili cookie: ${cookieString}`);
            await browser.close();
            return cookieString;
        });
    },
    clearCookie: (ctx) => {
        ctx.cache.set('bili-cookie');
        disableConfigCookie = true;
    },
    getWbiVerifyString: (ctx) => {
        const key = 'bili-wbi-verify-string';
        return ctx.cache.tryGet(key, async () => {
            const cookie = await module.exports.getCookie(ctx);
            const { data: navResponse } = await got('https://api.bilibili.com/x/web-interface/nav', {
                headers: {
                    Referer: 'https://www.bilibili.com/',
                    Cookie: cookie,
                },
            });
            const imgUrl = navResponse.data.wbi_img.img_url;
            const subUrl = navResponse.data.wbi_img.sub_url;
            const r = imgUrl.substring(imgUrl.lastIndexOf('/') + 1, imgUrl.length).split('.')[0] + subUrl.substring(subUrl.lastIndexOf('/') + 1, subUrl.length).split('.')[0];
            // const { body: spaceResponse } = await got('https://space.bilibili.com/1', {
            //     headers: {
            //         Referer: 'https://www.bilibili.com/',
            //         Cookie: cookie,
            //     },
            // });
            // const jsUrl = 'https:' + spaceResponse.match(/[^"]*9.space[^"]*/);
            const jsUrl = 'https://s1.hdslb.com/bfs/seed/laputa-header/bili-header.umd.js';
            const { body: jsResponse } = await got(jsUrl, {
                headers: {
                    Referer: 'https://space.bilibili.com/1',
                },
            });
            // const array = [
            //     46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57,
            //     62, 11, 36, 20, 34, 44, 52,
            // ];
            const array = JSON.parse(jsResponse.match(/\[(?:\d+,){63}\d+]/));
            const o = [];
            for (const t of array) {
                r.charAt(t) && o.push(r.charAt(t));
            }
            return o.join('').slice(0, 32);
        });
    },
    getUsernameFromUID: (ctx, uid) => {
        const key = 'bili-username-from-uid-' + uid;
        return ctx.cache.tryGet(key, async () => {
            const cookie = await module.exports.getCookie(ctx);
            const wbiVerifyString = await module.exports.getWbiVerifyString(ctx);
            // await got(`https://space.bilibili.com/${uid}/`, {
            //     headers: {
            //         Referer: 'https://www.bilibili.com/',
            //         Cookie: cookie,
            //     },
            // });
            const params = utils.addWbiVerifyInfo(`mid=${uid}&token=&platform=web&web_location=1550101`, wbiVerifyString);
            const { data: nameResponse } = await got(`https://api.bilibili.com/x/space/wbi/acc/info?${params}`, {
                headers: {
                    Referer: `https://space.bilibili.com/${uid}/`,
                    Cookie: cookie,
                },
            });
            return nameResponse.data ? nameResponse.data.name : undefined;
        });
    },
    getUsernameAndFaceFromUID: async (ctx, uid) => {
        const nameKey = 'bili-username-from-uid-' + uid;
        const faceKey = 'bili-userface-from-uid-' + uid;
        let name = await ctx.cache.get(nameKey);
        let face = await ctx.cache.get(faceKey);
        if (!name || !face) {
            const cookie = await module.exports.getCookie(ctx);
            const wbiVerifyString = await module.exports.getWbiVerifyString(ctx);
            // await got(`https://space.bilibili.com/${uid}/`, {
            //     headers: {
            //         Referer: `https://www.bilibili.com/`,
            //         Cookie: cookie,
            //     },
            // });
            const params = utils.addWbiVerifyInfo(`mid=${uid}&token=&platform=web&web_location=1550101`, wbiVerifyString);
            const { data: nameResponse } = await got(`https://api.bilibili.com/x/space/wbi/acc/info?${params}`, {
                headers: {
                    Referer: `https://space.bilibili.com/${uid}/`,
                    Cookie: cookie,
                },
            });
            if (nameResponse.data.name) {
                name = nameResponse.data.name;
                face = nameResponse.data.face;
            } else {
                logger.error(`Error when visiting /x/space/wbi/acc/info: ${JSON.stringify(nameResponse)}`);
            }
            ctx.cache.set(nameKey, name);
            ctx.cache.set(faceKey, face);
        }
        return [name, face];
    },
    getLiveIDFromShortID: (ctx, shortID) => {
        const key = `bili-liveID-from-shortID-${shortID}`;
        return ctx.cache.tryGet(key, async () => {
            const { data: liveIDResponse } = await got(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${shortID}`, {
                headers: {
                    Referer: `https://live.bilibili.com/${shortID}`,
                },
            });
            return liveIDResponse.data.room_id;
        });
    },
    getUsernameFromLiveID: (ctx, liveID) => {
        const key = `bili-username-from-liveID-${liveID}`;
        return ctx.cache.tryGet(key, async () => {
            const { data: nameResponse } = await got(`https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${liveID}`, {
                headers: {
                    Referer: `https://live.bilibili.com/${liveID}`,
                },
            });
            return nameResponse.data.info.uname;
        });
    },
    getVideoNameFromId: (ctx, aid, bvid) => {
        const key = `bili-videoname-from-id-${bvid || aid}`;
        return ctx.cache.tryGet(key, async () => {
            const { data } = await got(`https://api.bilibili.com/x/web-interface/view`, {
                searchParams: {
                    aid: aid || undefined,
                    bvid: bvid || undefined,
                },
                referer: `https://www.bilibili.com/video/${bvid || `av${aid}`}`,
            });
            return data.data.title;
        });
    },
    getCidFromId: (ctx, aid, pid, bvid) => {
        const key = `bili-cid-from-id-${bvid || aid}-${pid}`;
        return ctx.cache.tryGet(key, async () => {
            const { data } = await got(`https://api.bilibili.com/x/web-interface/view?${bvid ? `bvid=${bvid}` : `aid=${aid}`}`, {
                referer: `https://www.bilibili.com/video/${bvid || `av${aid}`}`,
            });
            return data.data.pages[pid - 1].cid;
        });
    },
    getAidFromBvid: async (ctx, bvid) => {
        const key = `bili-cid-from-bvid-${bvid}`;
        let aid = await ctx.cache.get(key);
        if (!aid) {
            const response = await got(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                headers: {
                    Referer: `https://www.bilibili.com/video/${bvid}`,
                },
            });
            if (response.data && response.data.data && response.data.data.aid) {
                aid = response.data.data.aid;
            }
            ctx.cache.set(key, aid);
        }
        return aid;
    },
    getArticleDataFromCvid: async (ctx, cvid, uid) => {
        const url = `https://www.bilibili.com/read/cv${cvid}/`;
        const data = await ctx.cache.tryGet(
            url,
            async () =>
                (
                    await got({
                        method: 'get',
                        url,
                        headers: {
                            Referer: `https://space.bilibili.com/${uid}/`,
                        },
                    })
                ).data
        );
        const $ = cheerio.load(data);
        let description = $('#read-article-holder').html();
        if (!description) {
            try {
                const newFormatData = JSON.parse(
                    $('script:contains("window.__INITIAL_STATE__")')
                        .text()
                        .match(/window\.__INITIAL_STATE__\s*=\s*(.*?);\(/)[1]
                );

                if (newFormatData?.readInfo?.opus?.content?.paragraphs) {
                    description = '';
                    for (const element of newFormatData.readInfo.opus.content.paragraphs) {
                        if (element.para_type === 1) {
                            for (const text of element.text.nodes) {
                                if (text?.word?.words) {
                                    description += `<p>${text.word.words}</p>`;
                                }
                            }
                        }
                        if (element.para_type === 2) {
                            for (const image of element.pic.pics) {
                                description += `<p ><img src="${image.url}@progressive.webp"></p>`;
                            }
                        }
                        if (element.para_type === 3 && element.line?.pic?.url) {
                            description += `<figure><img src="${element.line.pic.url}"></figure>`;
                        }
                    }
                }
            } catch {
                /* empty */
            }
        }
        return { url, description };
    },
};
