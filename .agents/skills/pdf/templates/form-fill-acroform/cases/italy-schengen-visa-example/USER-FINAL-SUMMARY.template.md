# 意大利签证申请表填写说明 - {{APPLICANT_NAME}}

已生成填写后的 PDF：`{{OUTPUT_PDF}}`

## 已从材料提取并填写的信息

- 姓名：`{{SURNAME_PINYIN}} / {{GIVEN_PINYIN}}`
- 护照号码：`{{PASSPORT_NUMBER}}`
- 出生日期：`{{DOB_DD_MM_YYYY}}`
- 出生地：`{{PLACE_OF_BIRTH}}`
- 当前职业：`{{OCCUPATION_EN}}`
- 雇主：`{{EMPLOYER_EN}}`；电话 `{{EMPLOYER_PHONE}}`
- 旅行目的：Tourism
- 目的国：Italy
- 首个入境地：`ITALY - {{FIRST_ENTRY_CITY_EN}}`
- 入境日期：`{{ARRIVAL_DD_MM_YYYY}}`
- 离境日期：`{{DEPARTURE_DD_MM_YYYY}}`
- 停留天数：`{{DURATION_DAYS}}`
- 首晚住宿：`{{FIRST_HOTEL_NAME_ADDRESS}}`
- 费用承担：申请人本人

## 缺失/需本人补充的信息

以下信息在所给材料中没有明确提供，未擅自编造：

1. 护照签发日期、有效期至、签发机关。
2. 个人家庭住址、真实联系电话、电子邮箱。
3. 当前国籍、出生国、出生时国籍。
4. 性别、婚姻状况、身份证号码。
5. 是否过去三年获得申根签证、是否采集过指纹及相关日期。
6. 酒店电话/传真、邮箱；后续住宿详细清单如需完整填写也需补充。
7. 交通/住宿预付、现金/信用卡等具体支持方式凭证信息。
8. 申请地点和日期、签名（第 36/37 项以及最后签名处需本人手写）。
9. 照片（照片框通常不是 AcroForm 字段，需线下粘贴或上传）。
10. 如适用：欧盟/欧洲经济区/瑞士家庭成员信息。
11. 未成年人监护人信息；申请人为成年人时通常不适用。

## 验证记录

- 目标表单经检测为 AcroForm，使用字段名和页码写入，不使用额外页面或封面。
- 输出 PDF 可由 `pdfinfo` / `pdftotext` 读取，保持原表单页数和页面尺寸。
- 已核验关键字段：`{{SURNAME_PINYIN}}`、`{{GIVEN_PINYIN}}`、`{{PASSPORT_NUMBER}}`、`{{DOB_DD_MM_YYYY}}`、`{{OCCUPATION_EN}}`、`{{ARRIVAL_DD_MM_YYYY}}`、`{{DEPARTURE_DD_MM_YYYY}}`、`ITALY - {{FIRST_ENTRY_CITY_EN}}`、`{{DURATION_DAYS}}`。
