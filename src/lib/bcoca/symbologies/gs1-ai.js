/**
 * GS1 application identifiers (GS1 General Specifications): each AI with the length of its data
 * when that length is fixed ("01:14"), or without a length when it is variable ("10"). Used to
 * split GS1 element strings for the HRI of GS1-128 (BCOCA Code 128 modifier X'04').
 *
 * Derived from the "gs1syntax" table of Barcode Writer in Pure PostScript (BWIPP, barcode.ps,
 * resource gs1process, bwip-js 4.5.1):
 *
 *   Copyright (c) 2004-2024 Terry Burton
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify, merge,
 *   publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
 *   to whom the Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 *   INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 *   PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 *   FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 *   DEALINGS IN THE SOFTWARE.
 */

const PACKED =
  '10 11:6 12:6 13:6 15:6 16:6 17:6 20:2 21 22 30 37 90 91 92 93 94 95 96 97 98 99 235 240 241 242 ' +
  '243 250 251 253 254 255 400 401 402:17 403 410:13 411:13 412:13 413:13 414:13 415:13 416:13 ' +
  '417:13 420 421 422:3 423 424:3 425 426:3 427 710 711 712 713 714 715 3100:6 3101:6 3102:6 ' +
  '3103:6 3104:6 3105:6 3110:6 3111:6 3112:6 3113:6 3114:6 3115:6 3120:6 3121:6 3122:6 3123:6 ' +
  '3124:6 3125:6 3130:6 3131:6 3132:6 3133:6 3134:6 3135:6 3140:6 3141:6 3142:6 3143:6 3144:6 ' +
  '3145:6 3150:6 3151:6 3152:6 3153:6 3154:6 3155:6 3160:6 3161:6 3162:6 3163:6 3164:6 3165:6 ' +
  '3200:6 3201:6 3202:6 3203:6 3204:6 3205:6 3210:6 3211:6 3212:6 3213:6 3214:6 3215:6 3220:6 ' +
  '3221:6 3222:6 3223:6 3224:6 3225:6 3230:6 3231:6 3232:6 3233:6 3234:6 3235:6 3240:6 3241:6 ' +
  '3242:6 3243:6 3244:6 3245:6 3250:6 3251:6 3252:6 3253:6 3254:6 3255:6 3260:6 3261:6 3262:6 ' +
  '3263:6 3264:6 3265:6 3270:6 3271:6 3272:6 3273:6 3274:6 3275:6 3280:6 3281:6 3282:6 3283:6 ' +
  '3284:6 3285:6 3290:6 3291:6 3292:6 3293:6 3294:6 3295:6 3300:6 3301:6 3302:6 3303:6 3304:6 ' +
  '3305:6 3310:6 3311:6 3312:6 3313:6 3314:6 3315:6 3320:6 3321:6 3322:6 3323:6 3324:6 3325:6 ' +
  '3330:6 3331:6 3332:6 3333:6 3334:6 3335:6 3340:6 3341:6 3342:6 3343:6 3344:6 3345:6 3350:6 ' +
  '3351:6 3352:6 3353:6 3354:6 3355:6 3360:6 3361:6 3362:6 3363:6 3364:6 3365:6 3370:6 3371:6 ' +
  '3372:6 3373:6 3374:6 3375:6 3400:6 3401:6 3402:6 3403:6 3404:6 3405:6 3410:6 3411:6 3412:6 ' +
  '3413:6 3414:6 3415:6 3420:6 3421:6 3422:6 3423:6 3424:6 3425:6 3430:6 3431:6 3432:6 3433:6 ' +
  '3434:6 3435:6 3440:6 3441:6 3442:6 3443:6 3444:6 3445:6 3450:6 3451:6 3452:6 3453:6 3454:6 ' +
  '3455:6 3460:6 3461:6 3462:6 3463:6 3464:6 3465:6 3470:6 3471:6 3472:6 3473:6 3474:6 3475:6 ' +
  '3480:6 3481:6 3482:6 3483:6 3484:6 3485:6 3490:6 3491:6 3492:6 3493:6 3494:6 3495:6 3500:6 ' +
  '3501:6 3502:6 3503:6 3504:6 3505:6 3510:6 3511:6 3512:6 3513:6 3514:6 3515:6 3520:6 3521:6 ' +
  '3522:6 3523:6 3524:6 3525:6 3530:6 3531:6 3532:6 3533:6 3534:6 3535:6 3540:6 3541:6 3542:6 ' +
  '3543:6 3544:6 3545:6 3550:6 3551:6 3552:6 3553:6 3554:6 3555:6 3560:6 3561:6 3562:6 3563:6 ' +
  '3564:6 3565:6 3570:6 3571:6 3572:6 3573:6 3574:6 3575:6 3600:6 3601:6 3602:6 3603:6 3604:6 ' +
  '3605:6 3610:6 3611:6 3612:6 3613:6 3614:6 3615:6 3620:6 3621:6 3622:6 3623:6 3624:6 3625:6 ' +
  '3630:6 3631:6 3632:6 3633:6 3634:6 3635:6 3640:6 3641:6 3642:6 3643:6 3644:6 3645:6 3650:6 ' +
  '3651:6 3652:6 3653:6 3654:6 3655:6 3660:6 3661:6 3662:6 3663:6 3664:6 3665:6 3670:6 3671:6 ' +
  '3672:6 3673:6 3674:6 3675:6 3680:6 3681:6 3682:6 3683:6 3684:6 3685:6 3690:6 3691:6 3692:6 ' +
  '3693:6 3694:6 3695:6 3900 3901 3902 3903 3904 3905 3906 3907 3908 3909 3910 3911 3912 3913 3914 ' +
  '3915 3916 3917 3918 3919 3920 3921 3922 3923 3924 3925 3926 3927 3928 3929 3930 3931 3932 3933 ' +
  '3934 3935 3936 3937 3938 3939 3940:4 3941:4 3942:4 3943:4 3950:6 3951:6 3952:6 3953:6 3954:6 ' +
  '3955:6 4300 4301 4302 4303 4304 4305 4306 4307:2 4308 4309:20 4310 4311 4312 4313 4314 4315 ' +
  '4316 4317:2 4318 4319 4320 4321:1 4322:1 4323:1 4324:10 4325:10 4326:6 4330 4331 4332 4333 ' +
  '7001:13 7002 7003:10 7004 7005 7006:6 7007 7008 7009 7010 7011 7020 7021 7022 7023 7030 7031 ' +
  '7032 7033 7034 7035 7036 7037 7038 7039 7040:4 7230 7231 7232 7233 7234 7235 7236 7237 7238 ' +
  '7239 7240 7241:2 7242 7250:8 7251:12 7252:1 7253 7254 7255 7256 7257 7258:3 7259 8001:14 8002 ' +
  '8003 8004 8005:6 8006:18 8007 8008 8009 8010 8011 8012 8013 8014 8017:18 8018:18 8019 8020 ' +
  '8026:18 8030 8110 8111:4 8112 8200 00:18 01:14 02:14 03:14 ' +
  '';

/** AI → fixed data length, or 0 for variable length. */
export const GS1_AI = new Map(PACKED.trim().split(' ').map((e) => {
  const [ai, len] = e.split(':');
  return [ai, Number(len ?? 0)];
}));

/**
 * Puts the application identifiers of a GS1 element string in parentheses, e.g.
 * "019061414100768715001230" → "(01)90614141007687(15)001230". FNC1 separators end variable
 * length data.
 * @param {string[]} fields Data between FNC1 characters.
 * @returns {string|null} HRI text, or null if the data is not a valid sequence of AIs.
 */
export function gs1Hri(fields) {
  let out = '';
  for (const field of fields) {
    let p = 0;
    while (p < field.length) {
      const ai = [2, 3, 4].map((n) => field.slice(p, p + n)).find((a) => GS1_AI.has(a));
      if (!ai) return null;
      p += ai.length;
      const len = GS1_AI.get(ai);
      const end = len ? p + len : field.length;
      if (end > field.length) return null;
      out += `(${ai})${field.slice(p, end)}`;
      p = end;
    }
  }
  return out;
}
