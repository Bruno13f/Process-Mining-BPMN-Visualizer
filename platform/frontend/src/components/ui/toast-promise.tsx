/* eslint-disable */
import toast from "react-hot-toast";

export async function ToastPromise(promise: Promise<any>, loading: string, success: string, error: string) {
    return await toast.promise(promise, {
      loading: loading,
      success: success,
      error: error,
    }, {
      style: {
        borderRadius: '8px',
        background: '#fff !important',
        border: '1.5px solid #808080',
        boxShadow: 'none',
        color: '#222',
        fontWeight: 500,
        fontSize: '15px',
        zIndex: 9999,
        overflow: 'visible',
      },
    });
}