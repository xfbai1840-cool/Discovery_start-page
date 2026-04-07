import pandas as pd
import streamlit as st
import glob
import os
import io

# 1. 网页基础设置
st.set_page_config(page_title="实验室化合物智能匹配系统", page_icon="🧪", layout="wide")
st.title("🧪 实验室化合物智能补全与匹配系统")
st.markdown("上传您的查询表格，系统将自动在后台 MCE 数据库中进行无死角搜索，并为您补全 `Plate`、`Seat`、`ID`、`Name`、`CAS`、`MW`、`SMILES` 信息。")

# 2. 核心技术：使用缓存加载数据库
@st.cache_data
def load_master_db():
    excel_files = glob.glob('*.xlsx')
    db_files = [f for f in excel_files if ("Library" in f or "MCE" in f)]
    
    if not db_files:
        return None, None, None, None

    dfs = []
    for file in db_files:
        try:
            df = pd.read_excel(file, dtype=str)
            if 'Plate' in df.columns:
                # --- 核心更新：智能提取 #01 格式的板号 ---
                is_hash = df['Plate'].astype(str).str.startswith('#')
                if is_hash.any():
                    # 提取出类似 "# 01" 的字眼，并去掉空格变成 "#01"
                    df['Real_Plate'] = df['Plate'].apply(
                        lambda x: str(x).split('-')[0].replace(' ', '') if str(x).startswith('#') else None
                    )
                    # 向下填充，把 #01 赋值给下面紧跟着的所有具体化合物行
                    df['Real_Plate'] = df['Real_Plate'].ffill()
                    # 删除掉多余的整句注释行
                    df = df[~is_hash]
                    # 用 #01 覆盖原来的 HYCPKxxx
                    df['Plate'] = df['Real_Plate'].fillna(df['Plate'])
                    df = df.drop(columns=['Real_Plate'])
                else:
                    # 如果没有带 # 的注释行，也清洗一下可能残留的注释
                    df = df[~df['Plate'].astype(str).str.startswith('#')]
                # ----------------------------------------
                    
            dfs.append(df)
        except Exception as e:
            st.error(f"读取文件 {file} 失败: {e}")

    if not dfs:
        return None, None, None, None

    master_df = pd.concat(dfs, ignore_index=True).drop_duplicates()
    
    # 建立极速哈希索引字典
    master_records = master_df.to_dict('records')
    cas_dict, id_dict, smiles_dict, plate_seat_dict = {}, {}, {}, {}

    for row in master_records:
        if pd.notna(row.get('CAS')): cas_dict[str(row['CAS']).strip()] = row
        if pd.notna(row.get('ID')): id_dict[str(row['ID']).strip()] = row
        if pd.notna(row.get('SMILES')): smiles_dict[str(row['SMILES']).strip()] = row
        if pd.notna(row.get('Plate')) and pd.notna(row.get('Seat')):
            ps_key = f"{str(row['Plate']).strip()}_{str(row['Seat']).strip()}"
            plate_seat_dict[ps_key] = row
            
    return cas_dict, id_dict, smiles_dict, plate_seat_dict

# 在后台静默加载数据库
with st.spinner('系统正在初始化数据库，请稍候...'):
    cas_dict, id_dict, smiles_dict, plate_seat_dict = load_master_db()

if cas_dict is None:
    st.error("⚠️ 未在后台找到 MCE 化合物库文件，请联系管理员检查服务器配置。")
    st.stop()

# 3. 网页前端：文件上传组件
st.divider()
uploaded_file = st.file_uploader("📥 第一步：请在此处上传您要查询的表格 (支持 .xlsx 或 .csv)", type=['xlsx', 'xls', 'csv'])

if uploaded_file is not None:
    try:
        if uploaded_file.name.endswith('.csv'):
            query_df = pd.read_csv(uploaded_file, dtype=str)
        else:
            query_df = pd.read_excel(uploaded_file, dtype=str)
            
        st.success("文件读取成功！正在进行智能扫描匹配...")
        
        # 4. 执行匹配逻辑
        results = []
        target_cols = ['Plate', 'Seat', 'ID', 'Name', 'CAS', 'MW', 'SMILES']
        
        progress_bar = st.progress(0)
        total_rows = len(query_df)
        
        for index, row in query_df.iterrows():
            row_dict = row.to_dict()
            best_match = None

            # a. Plate + Seat 精确匹配
            if 'Plate' in row_dict and 'Seat' in row_dict:
                plate_val = str(row_dict['Plate']).strip()
                seat_val = str(row_dict['Seat']).strip()
                ps_key = f"{plate_val}_{seat_val}"
                if ps_key in plate_seat_dict:
                    best_match = plate_seat_dict[ps_key]

            # b. 全单元格盲扫模式
            if not best_match:
                for col_name, val in row_dict.items():
                    if pd.isna(val): continue
                    val_str = str(val).strip()
                    if not val_str: continue
                    
                    if val_str.upper() in ['CAS', 'VINA_SCORE', 'ID', 'SMILES', 'PLATE', 'SEAT', 'MW', 'NAME']:
                        continue
                        
                    if val_str in cas_dict: best_match = cas_dict[val_str]; break
                    elif val_str in id_dict: best_match = id_dict[val_str]; break
                    elif val_str in smiles_dict: best_match = smiles_dict[val_str]; break
            
            # c. 数据融合及白名单过滤
            if best_match:
                for k, v in best_match.items():
                    if k in target_cols:
                        if k not in row_dict or pd.isna(row_dict.get(k)) or str(row_dict.get(k)).strip() in ['', 'nan']:
                            row_dict[k] = v
            results.append(row_dict)
            
            progress_bar.progress((index + 1) / total_rows)

        out_df = pd.DataFrame(results)
        st.write("✅ **匹配完成！下方为结果预览：**")
        st.dataframe(out_df.head(10))

        # 5. 生成 Excel 供用户下载
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            out_df.to_excel(writer, index=False, sheet_name='Matched_Results')
        processed_data = output.getvalue()

        st.divider()
        st.download_button(
            label="🎉 第二步：点击下载完整匹配结果 (Excel)",
            data=processed_data,
            file_name=f"Result_{uploaded_file.name}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            type="primary"
        )
        
    except Exception as e:
        st.error(f"处理文件时发生错误: {e}")
