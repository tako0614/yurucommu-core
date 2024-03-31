import { useEffect, useState } from "preact/hooks";
const AddFriendForm = (props) => {
    useEffect(() => {
        const addFriendKey = props.addFriendKey
        const fetchData = async () => {
            
        }
    }, []);
  return (
    <>
      {true && (
        <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(91,112,131,0.4)] left-0 top-0">
          <div class="bg-[#010005] lg:w-1/3 w-full h-full lg:h-2/3 mx-auto lg:my-[7%] p-5 lg:rounded-xl">
            <div class="flex justify-end">
              <span
                class="ml-0 text-3xl text-gray-400 font-[bold] no-underline cursor-pointer"
                onClick={handleButtonClick}
              >
                ×
              </span>
            </div>
            //
          </div>
        </div>
      )}
    </>
  );
};
export default AddFriendForm;
